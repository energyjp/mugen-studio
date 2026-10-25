package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The window cannot be driven in a test, but where it looks for the server
// can. These pin the three cases appDir has to get right: a portable copy
// (program in app/, no studio.path), a checkout (server beside the exe), and
// an explicit studio.path, which keeps winning over both.

func TestAppDirFindsAppSubfolderWithoutStudioPath(t *testing.T) {
	dir := t.TempDir()
	app := filepath.Join(dir, "app")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, serverExe), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := appDir(filepath.Join(dir, "MugenStudio.exe")); got != app {
		t.Fatalf("appDir = %q, want %q", got, app)
	}
}

func TestAppDirStaysBesideExeWhenNothingElse(t *testing.T) {
	dir := t.TempDir()
	if got := appDir(filepath.Join(dir, "MugenStudio.exe")); got != dir {
		t.Fatalf("appDir = %q, want %q", got, dir)
	}
}

func TestAppDirHonorsStudioPathOverAppSubfolder(t *testing.T) {
	dir := t.TempDir()
	for _, sub := range []string{"app", "elsewhere"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, sub, serverExe), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "studio.path"), []byte("elsewhere\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, "elsewhere")
	if got := appDir(filepath.Join(dir, "MugenStudio.exe")); got != want {
		t.Fatalf("appDir = %q, want %q", got, want)
	}
}
