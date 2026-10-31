#!/usr/bin/env python3
"""Put the active Weston X11 output in a resizable, scrollable desktop window.

This reparents the live Weston X window into a Tk viewport. It does not capture,
encode, or stream frames. Close the viewport to return Weston to the desktop.
Requires Tkinter and xdotool; run as the logged-in desktop user.
"""

import argparse
import re
import subprocess
import tkinter as tk
from tkinter import ttk


def output_window():
    rows = subprocess.check_output(["wmctrl", "-lG"], text=True).splitlines()
    matches = [row.split() for row in rows if row.endswith("Weston Compositor - screen0")]
    if len(matches) != 1:
        raise SystemExit(f"Expected one Weston screen0 window, found {len(matches)}")
    row = matches[0]
    window, x, y, width, height = row[0], int(row[2]), int(row[3]), int(row[4]), int(row[5])
    props = subprocess.check_output(["xprop", "-id", window, "WM_CLASS"], text=True)
    if '"weston-1", "Weston Compositor"' not in props:
        raise SystemExit(f"Window {window} is not the expected Weston output")
    return window, x, y, width, height


def xdo(*args):
    subprocess.run(["xdotool", *map(str, args)], check=True, stdout=subprocess.DEVNULL)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--width", type=int, default=980, help="initial viewport width")
parser.add_argument("--height", type=int, default=680, help="initial viewport height")
args = parser.parse_args()

window, restore_x, restore_y, content_w, content_h = output_window()
root_info = subprocess.check_output(["xwininfo", "-root"], text=True)
root_match = re.search(r"Window id:\s+(0x[0-9a-fA-F]+)", root_info)
if not root_match:
    raise SystemExit("Could not determine the X11 root window")
root_id = root_match.group(1)

root = tk.Tk()
root.title("Weston Compositor — scrollable view")
root.geometry(f"{args.width}x{args.height}")
root.minsize(420, 320)
viewport = tk.Frame(root, bd=0, highlightthickness=0)
hbar = ttk.Scrollbar(root, orient="horizontal")
vbar = ttk.Scrollbar(root, orient="vertical")
corner = ttk.Frame(root, width=16, height=16)
corner.grid_propagate(False)
root.grid_rowconfigure(0, weight=1)
root.grid_columnconfigure(0, weight=1)
viewport.grid(row=0, column=0, sticky="nsew")
offset_x = offset_y = 0
embedded = False


def move_output():
    if embedded:
        xdo("windowmove", window, -offset_x, -offset_y)


def scroll(axis, *command):
    global offset_x, offset_y
    horizontal = axis == "x"
    span = max(0, (content_w - viewport.winfo_width()) if horizontal else (content_h - viewport.winfo_height()))
    current = offset_x if horizontal else offset_y
    if command[0] == "moveto":
        current = round(float(command[1]) * (content_w if horizontal else content_h))
    else:
        current += int(command[1]) * 40
    current = min(max(0, current), span)
    if horizontal:
        offset_x = current
    else:
        offset_y = current
    move_output()


hbar.configure(command=lambda *a: scroll("x", *a))
vbar.configure(command=lambda *a: scroll("y", *a))


def layout(_event=None):
    global offset_x, offset_y
    width, height = viewport.winfo_width(), viewport.winfo_height()
    need_h, need_v = content_w > width, content_h > height
    if need_v:
        vbar.grid(row=0, column=1, sticky="ns")
    else:
        vbar.grid_remove()
    if need_h:
        hbar.grid(row=1, column=0, sticky="ew")
    else:
        hbar.grid_remove()
    if need_h and need_v:
        corner.grid(row=1, column=1, sticky="nsew")
    else:
        corner.grid_remove()
    offset_x = min(offset_x, max(0, content_w - width))
    offset_y = min(offset_y, max(0, content_h - height))
    move_output()
    hbar.set(offset_x / content_w, min(1, (offset_x + width) / content_w))
    vbar.set(offset_y / content_h, min(1, (offset_y + height) / content_h))


viewport.bind("<Configure>", layout)


def restore():
    global embedded
    try:
        xdo("windowunmap", window)
        xdo("windowreparent", window, root_id)
        xdo("windowmove", window, restore_x, restore_y)
        xdo("windowmap", window)
        embedded = False
    finally:
        root.destroy()


root.protocol("WM_DELETE_WINDOW", restore)
root.update_idletasks()
xdo("windowreparent", window, viewport.winfo_id())
xdo("windowmove", window, 0, 0)
embedded = True
root.after_idle(layout)
root.mainloop()
