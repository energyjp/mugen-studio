package update

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// renameRetry renames, and keeps trying for d while the source is held: a
// server or a WebView2 process that has not let go yet, an antivirus scan. A
// source that is not there is not retried.
func renameRetry(from, to string, d time.Duration) error {
	return retryRename(os.Rename, from, to, d)
}

// replaceRetry is renameRetry for a file replacing another (replaceFile).
func replaceRetry(from, to string, d time.Duration) error {
	return retryRename(replaceFile, from, to, d)
}

func retryRename(rename func(string, string) error, from, to string, d time.Duration) error {
	deadline := time.Now().Add(d)
	for {
		err := rename(from, to)
		if err == nil {
			return nil
		}
		if errors.Is(err, os.ErrNotExist) && !exists(from) {
			return err
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s is in use (%v)", from, unwrapErrno(err))
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// readShared reads a whole file opened with FILE_SHARE_DELETE as well as
// read and write. os.ReadFile leaves FILE_SHARE_DELETE out, and while any
// process holds journal.json that way a rename over it fails with "Access is
// denied": the waiting launcher's 200 ms poll could make the new launcher's
// Confirm fail, and a working update was rolled back after 90 s.
func readShared(file string) ([]byte, error) {
	name, err := syscall.UTF16PtrFromString(file)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: file, Err: err}
	}
	f := os.NewFile(uintptr(h), file)
	defer f.Close()
	return io.ReadAll(f)
}

var procSetFileInformationByHandle = kernel32.NewProc("SetFileInformationByHandle")

const (
	fileRenameInfoEx        = 22
	fileRenameReplace       = 0x1 // FILE_RENAME_FLAG_REPLACE_IF_EXISTS
	fileRenamePosix         = 0x2 // FILE_RENAME_FLAG_POSIX_SEMANTICS
	accessDelete            = 0x00010000
	accessSynchronize       = 0x00100000
	fileFlagBackupSemantics = 0x02000000
)

// replaceFile renames from over to with POSIX semantics (Windows 10 1709
// and later, NTFS): the name is replaced even while a reader that shares
// delete (readShared, Node) has the old file open, which MoveFileEx - and so
// os.Rename - refuses with "Access is denied". Where that is not supported
// it falls back to os.Rename.
func replaceFile(from, to string) error {
	src, err := syscall.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	dst, err := syscall.UTF16FromString(to)
	if err != nil {
		return err
	}
	h, err := syscall.CreateFile(src, accessDelete|accessSynchronize,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, fileFlagBackupSemantics, 0)
	if err != nil {
		return os.Rename(from, to)
	}
	// FILE_RENAME_INFO: Flags (4, padded to 8), RootDirectory (8),
	// FileNameLength (4, bytes, no terminator), FileName.
	nameBytes := (len(dst) - 1) * 2
	buf := make([]byte, 20+nameBytes+2+8)
	*(*uint32)(unsafe.Pointer(&buf[0])) = fileRenameReplace | fileRenamePosix
	*(*uint32)(unsafe.Pointer(&buf[16])) = uint32(nameBytes)
	for i, c := range dst {
		*(*uint16)(unsafe.Pointer(&buf[20+2*i])) = c
	}
	r, _, callErr := procSetFileInformationByHandle.Call(uintptr(h), fileRenameInfoEx,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	syscall.CloseHandle(h)
	if r != 0 {
		return nil
	}
	if errno, ok := callErr.(syscall.Errno); ok && (errno == 87 || errno == 1 || errno == 50) {
		// ERROR_INVALID_PARAMETER / INVALID_FUNCTION / NOT_SUPPORTED: an
		// older Windows or a file system without POSIX renames.
		return os.Rename(from, to)
	}
	return &os.LinkError{Op: "rename", Old: from, New: to, Err: callErr}
}

func unwrapErrno(err error) error {
	var le *os.LinkError
	if errors.As(err, &le) {
		return le.Err
	}
	return err
}

const fileAttributeReparsePoint = 0x400

// isLink: a symbolic link or a junction (any reparse point), which is
// removed as itself and never followed.
func isLink(p string) bool {
	fi, err := os.Lstat(p)
	if err != nil {
		return false
	}
	if fi.Mode()&os.ModeSymlink != 0 || fi.Mode()&os.ModeIrregular != 0 {
		return true
	}
	if a, ok := fi.Sys().(*syscall.Win32FileAttributeData); ok && a.FileAttributes&fileAttributeReparsePoint != 0 {
		return true
	}
	return false
}

// removeTree deletes p, which must be inside root/.update. A junction or
// link anywhere in it is unlinked, never descended into (GRAIL: never
// recursive-delete through a junction). A missing p is fine.
func removeTree(root, p string) error {
	base, err := filepath.Abs(filepath.Join(root, dirName))
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(strings.ToLower(abs)+string(filepath.Separator), strings.ToLower(base)+string(filepath.Separator)) {
		return fmt.Errorf("refusing to delete %s: it is not in %s", abs, base)
	}
	return removeAll(abs)
}

func removeAll(p string) error {
	fi, err := os.Lstat(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if isLink(p) {
		// os.Remove: DeleteFile, then RemoveDirectory, which removes a
		// junction itself and leaves what it points at alone.
		return os.Remove(p)
	}
	if fi.IsDir() {
		ents, err := os.ReadDir(p)
		if err != nil {
			return err
		}
		for _, e := range ents {
			if err := removeAll(filepath.Join(p, e.Name())); err != nil {
				return err
			}
		}
	}
	err = os.Remove(p)
	if err != nil && !fi.IsDir() {
		// A read-only file: clear the attribute and try again.
		_ = os.Chmod(p, 0o666)
		err = os.Remove(p)
	}
	return err
}
