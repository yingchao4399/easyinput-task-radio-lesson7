"""Read-only EasyInput USB HID identification and input report probe.

This script never sends output or feature reports to the device.
"""

import argparse
import time

import hid


VENDOR_ID = 0x303A
PRODUCT_ID = 0x1006


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=5)
    args = parser.parse_args()

    devices = [
        device
        for device in hid.enumerate(VENDOR_ID, PRODUCT_ID)
        if device.get("bus_type") == 1
    ]
    print(f"USB EasyInput HID collections: {len(devices)}")
    for device in devices:
        print(
            "collection",
            f"usage_page=0x{device['usage_page']:04x}",
            f"usage=0x{device['usage']:02x}",
            f"serial={device.get('serial_number')}",
            f"product={device.get('product_string')}",
        )

    opened = []
    for device in devices:
        handle = hid.device()
        try:
            handle.open_path(device["path"])
            handle.set_nonblocking(True)
            opened.append((device, handle))
            descriptor = bytes(handle.get_report_descriptor())
            print(
                "opened",
                f"usage_page=0x{device['usage_page']:04x}",
                f"usage=0x{device['usage']:02x}",
                f"descriptor_bytes={len(descriptor)}",
            )
        except OSError as error:
            print(
                "open_failed",
                f"usage_page=0x{device['usage_page']:04x}",
                f"usage=0x{device['usage']:02x}",
                str(error),
            )
            handle.close()

    end = time.monotonic() + args.seconds
    reports = 0
    try:
        while time.monotonic() < end:
            for device, handle in opened[:]:
                try:
                    data = bytes(handle.read(64))
                except OSError as error:
                    print(
                        "read_failed",
                        f"usage_page=0x{device['usage_page']:04x}",
                        f"usage=0x{device['usage']:02x}",
                        str(error),
                    )
                    handle.close()
                    opened.remove((device, handle))
                    continue
                if data:
                    reports += 1
                    print(
                        "input_report",
                        f"usage_page=0x{device['usage_page']:04x}",
                        f"usage=0x{device['usage']:02x}",
                        f"report_id=0x{data[0]:02x}",
                        f"length={len(data)}",
                        f"first_16={data[:16].hex(' ')}",
                        flush=True,
                    )
            time.sleep(0.02)
    finally:
        for _, handle in opened:
            handle.close()
    print(f"captured_input_reports={reports}")


if __name__ == "__main__":
    main()
