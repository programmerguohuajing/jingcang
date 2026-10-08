#!/bin/sh
set -eu
echo "PLATFORM=$(uname -s)"
echo "ARCH=$(uname -m)"
if [ -e /dev/kvm ]; then
  echo "KVM_DEVICE=present"
  if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then echo "KVM_ACCESS=ready"; else echo "KVM_ACCESS=permission_denied"; fi
else
  echo "KVM_DEVICE=missing"
  echo "KVM_ACCESS=unavailable"
fi
if [ -r /proc/cpuinfo ]; then
  if grep -Eq '\b(vmx|svm)\b' /proc/cpuinfo; then echo "CPU_VIRTUALIZATION_FLAGS=present"; else echo "CPU_VIRTUALIZATION_FLAGS=missing"; fi
fi
if command -v df >/dev/null 2>&1; then df -Pk /tmp | awk 'NR==2 {print "TMP_FREE_KB="$4}'; fi
if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/system-images" ]; then
  echo "ANDROID_SYSTEM_IMAGES=present"
else
  echo "ANDROID_SYSTEM_IMAGES=not_configured"
fi
if [ ! -e /dev/kvm ]; then
  echo "ANDROID_KVM_EMULATOR_READY=false"
  exit 2
fi
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "ANDROID_KVM_EMULATOR_READY=false"
  exit 3
fi
echo "ANDROID_KVM_EMULATOR_READY=host_device_ready"
