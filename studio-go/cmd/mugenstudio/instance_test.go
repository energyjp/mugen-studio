package main

import (
	"fmt"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The second claim on one folder's name sees the first; another folder's name
// is free. A name of this test's own (pid + time), so a Studio open on this
// machine is never involved.
func TestClaimInstance(t *testing.T) {
	folder := fmt.Sprintf(`C:\Mugen Studio Test %d %d\app`, os.Getpid(), time.Now().UnixNano())
	name := instanceMutexName(folder)
	h1, already, err := claimInstance(name)
	if err != nil || h1 == 0 {
		t.Fatalf("first claim: handle %v, err %v", h1, err)
	}
	defer syscall.CloseHandle(syscall.Handle(h1))
	if already {
		t.Fatal("first claim reported the folder already open")
	}
	h2, already, err := claimInstance(name)
	if err != nil || h2 == 0 {
		t.Fatalf("second claim: handle %v, err %v", h2, err)
	}
	defer syscall.CloseHandle(syscall.Handle(h2))
	if !already {
		t.Fatal("second claim on the same folder was not refused")
	}
	h3, already, err := claimInstance(instanceMutexName(folder + "2"))
	if err != nil || h3 == 0 {
		t.Fatalf("other folder: handle %v, err %v", h3, err)
	}
	defer syscall.CloseHandle(syscall.Handle(h3))
	if already {
		t.Fatal("another folder's name was reported as already open")
	}
}

// One folder, however it is spelled, is one name: Windows paths are not
// case-sensitive, and a trailing separator or a dot segment is the same folder.
func TestInstanceMutexName(t *testing.T) {
	a := instanceMutexName(`C:\Games\Mugen Studio\app`)
	for _, same := range []string{`c:\games\mugen studio\APP`, `C:\Games\Mugen Studio\app\`, `C:\Games\Mugen Studio\.\app`} {
		if got := instanceMutexName(same); got != a {
			t.Errorf("%q -> %q, want %q", same, got, a)
		}
	}
	if b := instanceMutexName(`C:\Games\Mugen Studio 2\app`); b == a {
		t.Errorf("two folders share the name %q", a)
	}
	if !strings.HasPrefix(a, `Local\MugenStudio-`) || len(a) != len(`Local\MugenStudio-`)+16 {
		t.Errorf("name %q is not Local\\MugenStudio- + 16 hex", a)
	}
}
