"""Read-only EasyInput BLE service and standard telemetry probe."""

import asyncio

from bleak import BleakClient, BleakScanner


ADDRESS = "C4:9E:7E:07:4F:CE"
STANDARD_READS = {
    "00002a19-0000-1000-8000-00805f9b34fb": "battery_percent",
    "00002a24-0000-1000-8000-00805f9b34fb": "model_number",
    "00002a26-0000-1000-8000-00805f9b34fb": "firmware_revision",
    "00002a29-0000-1000-8000-00805f9b34fb": "manufacturer",
}


async def main():
    nearby = await BleakScanner.discover(timeout=8)
    matches = [
        device
        for device in nearby
        if device.address.upper() == ADDRESS or "EasyInput" in (device.name or "")
    ]
    print("nearby_ble_devices", len(nearby), "easyinput_matches", len(matches))
    for device in matches:
        print("discovered", device.name, device.address)
    if not matches:
        print("No live EasyInput BLE advertisement found; Windows pairing records alone do not prove an active BLE link.")
        return

    async with BleakClient(matches[0], timeout=15) as client:
        print("connected", client.is_connected, "address", ADDRESS)
        for service in client.services:
            print("service", service.uuid, service.description)
            for characteristic in service.characteristics:
                print(
                    "characteristic",
                    characteristic.uuid,
                    "properties",
                    ",".join(characteristic.properties),
                )
                label = STANDARD_READS.get(characteristic.uuid.lower())
                if label and "read" in characteristic.properties:
                    try:
                        raw = bytes(await client.read_gatt_char(characteristic))
                        value = raw[0] if label == "battery_percent" and raw else raw.decode("utf-8", errors="replace")
                        print("read", label, value)
                    except Exception as error:
                        print("read_failed", label, type(error).__name__, str(error))


if __name__ == "__main__":
    asyncio.run(main())
