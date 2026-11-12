//go:build !windows

package main

// audioDeviceName — заглушка для не-Windows платформ (dev-сборки под Linux/macOS).
func audioDeviceName() string {
	return "Системный по умолчанию"
}
