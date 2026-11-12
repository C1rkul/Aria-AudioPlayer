//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	winmmDLL               = syscall.NewLazyDLL("winmm.dll")
	procWaveOutGetDevCapsW = winmmDLL.NewProc("waveOutGetDevCapsW")
)

// waveOutCaps — WAVEOUTCAPSW: структура без указателей, лейаут одинаков на x86 и x64.
type waveOutCaps struct {
	wMid           uint16
	wPid           uint16
	vDriverVersion uint32
	szPname        [32]uint16
	dwFormats      uint32
	wChannels      uint16
	wReserved1     uint16
	dwSupport      uint32
}

// audioDeviceName — имя устройства вывода по умолчанию (waveOut, device 0 = WAVE_MAPPER).
// Windows-специфичная реализация; на других ОС см. system_other.go.
func audioDeviceName() string {
	var caps waveOutCaps
	ret, _, _ := procWaveOutGetDevCapsW.Call(
		0,
		uintptr(unsafe.Pointer(&caps)),
		unsafe.Sizeof(caps),
	)
	if ret != 0 { // MMSYSERR_NOERROR == 0
		return "Системный по умолчанию"
	}
	n := 0
	for n < len(caps.szPname) && caps.szPname[n] != 0 {
		n++
	}
	if n == 0 {
		return "Системный по умолчанию"
	}
	return syscall.UTF16ToString(caps.szPname[:n])
}
