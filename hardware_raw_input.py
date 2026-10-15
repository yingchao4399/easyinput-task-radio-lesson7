"""Capture only EasyInput keyboard/mouse Raw Input events on Windows.

No input is injected and no USB or BLE command is sent to the board.
"""

import argparse
import ctypes
import json
import queue
import struct
import threading
import time
from ctypes import wintypes
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WM_INPUT = 0x00FF
PM_REMOVE = 0x0001
RID_INPUT = 0x10000003
RIDI_DEVICENAME = 0x20000007
RIDEV_INPUTSINK = 0x00000100
RIM_TYPEMOUSE = 0
RIM_TYPEKEYBOARD = 1


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD),
        ("hwndTarget", wintypes.HWND),
    ]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [
        ("dwType", wintypes.DWORD),
        ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE),
        ("wParam", wintypes.WPARAM),
    ]


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("style", wintypes.UINT),
        ("lpfnWndProc", ctypes.c_void_p),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
        ("hIconSm", wintypes.HICON),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
        ("lPrivate", wintypes.DWORD),
    ]


WNDPROC = ctypes.WINFUNCTYPE(
    ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)
user32.DefWindowProcW.argtypes = [
    wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
]
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.RegisterClassExW.argtypes = [ctypes.POINTER(WNDCLASSEXW)]
user32.RegisterClassExW.restype = wintypes.ATOM
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p,
]
user32.CreateWindowExW.restype = wintypes.HWND
user32.RegisterRawInputDevices.argtypes = [
    ctypes.POINTER(RAWINPUTDEVICE), wintypes.UINT, wintypes.UINT
]
user32.RegisterRawInputDevices.restype = wintypes.BOOL
user32.GetRawInputData.argtypes = [
    wintypes.HANDLE, wintypes.UINT, ctypes.c_void_p,
    ctypes.POINTER(wintypes.UINT), wintypes.UINT,
]
user32.GetRawInputData.restype = wintypes.UINT
user32.GetRawInputDeviceInfoW.argtypes = [
    wintypes.HANDLE, wintypes.UINT, ctypes.c_void_p,
    ctypes.POINTER(wintypes.UINT),
]
user32.GetRawInputDeviceInfoW.restype = wintypes.UINT
user32.PeekMessageW.argtypes = [
    ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT
]
user32.PeekMessageW.restype = wintypes.BOOL
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE


def device_name(device_handle):
    chars = wintypes.UINT(0)
    user32.GetRawInputDeviceInfoW(device_handle, RIDI_DEVICENAME, None, ctypes.byref(chars))
    if not chars.value:
        return ""
    buffer = ctypes.create_unicode_buffer(chars.value)
    result = user32.GetRawInputDeviceInfoW(
        device_handle, RIDI_DEVICENAME, buffer, ctypes.byref(chars)
    )
    return buffer.value if result != 0xFFFFFFFF else ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--forward-url", default=None)
    args = parser.parse_args()

    if args.forward_url and urlsplit(args.forward_url).hostname not in {
        "127.0.0.1", "localhost"
    }:
        parser.error("--forward-url must target localhost")

    names = {}
    count = 0
    pressed = set()
    outbound = queue.Queue()

    def forward_worker():
        while True:
            key_id = outbound.get()
            if key_id is None:
                return
            body = json.dumps({"keyId": key_id}).encode("utf-8")
            request = Request(
                args.forward_url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urlopen(request, timeout=2) as response:
                    print("forwarded", f"S{key_id}", response.status, flush=True)
            except Exception as error:
                print("forward_failed", f"S{key_id}", str(error), flush=True)

    worker = None
    if args.forward_url:
        worker = threading.Thread(target=forward_worker, daemon=True)
        worker.start()

    @WNDPROC
    def window_proc(hwnd, message, wparam, lparam):
        nonlocal count
        if message == WM_INPUT:
            size = wintypes.UINT(0)
            header_size = ctypes.sizeof(RAWINPUTHEADER)
            user32.GetRawInputData(
                lparam, RID_INPUT, None, ctypes.byref(size), header_size
            )
            if size.value < header_size:
                return 0
            buffer = ctypes.create_string_buffer(size.value)
            got = user32.GetRawInputData(
                lparam, RID_INPUT, buffer, ctypes.byref(size), header_size
            )
            if got == 0xFFFFFFFF:
                return 0
            header = RAWINPUTHEADER.from_buffer_copy(buffer.raw)
            handle = header.hDevice
            if handle not in names:
                names[handle] = device_name(handle)
            name = names[handle].upper()
            if "VID_303A" not in name or "PID_1006" not in name:
                return 0
            source = "USB" if "HID#VID_303A" in name else "BLE"
            payload = buffer.raw[header_size:got]
            if header.dwType == RIM_TYPEKEYBOARD and len(payload) >= 16:
                make, flags, _, vkey, msg, _ = struct.unpack_from("<HHHHII", payload)
                is_up = bool(flags & 1)
                print(
                    "key", source, f"vkey=0x{vkey:02x}",
                    f"scan=0x{make:02x}", "up" if is_up else "down",
                    f"message=0x{msg:04x}", flush=True,
                )
                count += 1
                identity = (handle, vkey)
                if is_up:
                    pressed.discard(identity)
                elif identity not in pressed:
                    pressed.add(identity)
                    if args.forward_url and source == "USB" and 0x31 <= vkey <= 0x38:
                        outbound.put(vkey - 0x30)
            elif header.dwType == RIM_TYPEMOUSE and len(payload) >= 24:
                button_flags, button_data = struct.unpack_from("<HH", payload, 4)
                x, y = struct.unpack_from("<ii", payload, 12)
                print(
                    "mouse", source, f"buttons=0x{button_flags:04x}",
                    f"button_data=0x{button_data:04x}", f"dx={x}", f"dy={y}",
                    flush=True,
                )
                count += 1
            return 0
        return user32.DefWindowProcW(hwnd, message, wparam, lparam)

    class_name = f"EasyInputRawProbe_{int(time.time() * 1000)}"
    module = kernel32.GetModuleHandleW(None)
    window_class = WNDCLASSEXW()
    window_class.cbSize = ctypes.sizeof(WNDCLASSEXW)
    window_class.lpfnWndProc = ctypes.cast(window_proc, ctypes.c_void_p).value
    window_class.hInstance = module
    window_class.lpszClassName = class_name
    if not user32.RegisterClassExW(ctypes.byref(window_class)):
        raise OSError(ctypes.get_last_error(), "RegisterClassExW failed")
    hwnd = user32.CreateWindowExW(
        0, class_name, "EasyInput Raw Input Probe", 0,
        0, 0, 0, 0, None, None, module, None,
    )
    if not hwnd:
        raise OSError(ctypes.get_last_error(), "CreateWindowExW failed")

    targets = (RAWINPUTDEVICE * 2)(
        RAWINPUTDEVICE(1, 6, RIDEV_INPUTSINK, hwnd),
        RAWINPUTDEVICE(1, 2, RIDEV_INPUTSINK, hwnd),
    )
    if not user32.RegisterRawInputDevices(
        targets, len(targets), ctypes.sizeof(RAWINPUTDEVICE)
    ):
        raise OSError(ctypes.get_last_error(), "RegisterRawInputDevices failed")
    print("Ready: listening for EasyInput physical keyboard/mouse events", flush=True)

    end = time.monotonic() + args.seconds
    message = MSG()
    while time.monotonic() < end:
        while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_REMOVE):
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
        time.sleep(0.01)
    if worker:
        outbound.put(None)
        worker.join(timeout=3)
    print(f"captured_board_events={count}")


if __name__ == "__main__":
    main()
