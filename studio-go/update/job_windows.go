package update

import (
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

// THE NEW LAUNCHER RUNS IN A JOB OBJECT while the old one waits for it, so a
// new version that hangs can be ended - with its server and its WebView2
// processes - through the handle this process holds, never by a process id
// that may by then name something else. Once it confirms, the job lets go
// (KILL_ON_JOB_CLOSE cleared) and the new Studio runs on by itself.

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
	procOpenProcess              = kernel32.NewProc("OpenProcess")
)

const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x2000
	processSetQuota                   = 0x0100
	processTerminate                  = 0x0001
)

type ioCounters struct {
	ReadOperationCount, WriteOperationCount, OtherOperationCount uint64
	ReadTransferCount, WriteTransferCount, OtherTransferCount    uint64
}

type jobBasicLimit struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobExtendedLimit struct {
	BasicLimitInformation jobBasicLimit
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func setKillOnClose(job syscall.Handle, on bool) error {
	var info jobExtendedLimit
	if on {
		info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	}
	r, _, err := procSetInformationJobObject.Call(uintptr(job), jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r == 0 {
		return err
	}
	return nil
}

type jobChild struct {
	cmd    *exec.Cmd
	job    syscall.Handle
	exited chan struct{}
	once   sync.Once
}

func (c *jobChild) Exited() <-chan struct{} { return c.exited }

func (c *jobChild) Kill() {
	c.once.Do(func() {
		if c.job != 0 {
			procTerminateJobObject.Call(uintptr(c.job), 1)
			syscall.CloseHandle(c.job)
		}
		_ = c.cmd.Process.Kill()
	})
	<-c.exited
}

func (c *jobChild) Release() {
	c.once.Do(func() {
		if c.job != 0 {
			_ = setKillOnClose(c.job, false)
			syscall.CloseHandle(c.job)
		}
	})
}

// StartInJob starts cmd inside a new job object that ends everything in it
// when Kill is called (or when this process dies before Release).
func StartInJob(cmd *exec.Cmd) (Child, error) {
	h, _, err := procCreateJobObjectW.Call(0, 0)
	if h == 0 {
		return nil, err
	}
	job := syscall.Handle(h)
	if err := setKillOnClose(job, true); err != nil {
		syscall.CloseHandle(job)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		syscall.CloseHandle(job)
		return nil, err
	}
	// The process is alive and this process holds it (os.Process keeps a
	// handle), so its id names it here.
	ph, _, _ := procOpenProcess.Call(processSetQuota|processTerminate, 0, uintptr(cmd.Process.Pid))
	if ph != 0 {
		procAssignProcessToJobObject.Call(uintptr(job), ph)
		syscall.CloseHandle(syscall.Handle(ph))
	}
	c := &jobChild{cmd: cmd, job: job, exited: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(c.exited) }()
	return c, nil
}
