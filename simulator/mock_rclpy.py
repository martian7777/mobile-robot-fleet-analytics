"""A minimal, API-compatible fallback for ROS2's ``rclpy``.

The warehouse simulator is written against the *real* ROS2 Python client
library. On a machine that has ROS2 installed, ``import rclpy`` succeeds and the
simulator behaves as a genuine ROS2 node. On a plain Windows/macOS developer box
(or inside our slim Docker image) ROS2 is absent, so the simulator transparently
imports *this* module instead, which re-implements the small subset of the rclpy
surface the simulator uses on top of a single-process in-memory pub/sub bus.

Supported surface
------------------
    rclpy.init() / rclpy.shutdown() / rclpy.ok()
    rclpy.spin_once(node, timeout_sec=...)
    node = Node("name")
    pub  = node.create_publisher(msg_type, topic, qos)
    sub  = node.create_subscription(msg_type, topic, callback, qos)
    timer = node.create_timer(period_sec, callback)
    pub.publish(msg)

Messages are plain Python objects (any class), so callers can use lightweight
dataclasses instead of generated ROS .msg types.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any, Callable, Dict, List


# --------------------------------------------------------------------------- #
# In-memory broker shared by every Node in the process.
# --------------------------------------------------------------------------- #
class _Bus:
    def __init__(self) -> None:
        self._subscribers: Dict[str, List[Callable[[Any], None]]] = defaultdict(list)
        self._lock = threading.Lock()

    def subscribe(self, topic: str, callback: Callable[[Any], None]) -> None:
        with self._lock:
            self._subscribers[topic].append(callback)

    def publish(self, topic: str, msg: Any) -> None:
        with self._lock:
            callbacks = list(self._subscribers.get(topic, ()))
        for cb in callbacks:
            cb(msg)


_BUS = _Bus()
_OK = False


# --------------------------------------------------------------------------- #
# Publisher / Subscription / Timer
# --------------------------------------------------------------------------- #
class Publisher:
    def __init__(self, topic: str) -> None:
        self.topic = topic

    def publish(self, msg: Any) -> None:
        _BUS.publish(self.topic, msg)


class Subscription:
    def __init__(self, topic: str, callback: Callable[[Any], None]) -> None:
        self.topic = topic
        self.callback = callback
        _BUS.subscribe(topic, callback)


class Timer:
    """A wall-clock timer driven from :func:`spin_once`."""

    def __init__(self, period_sec: float, callback: Callable[[], None]) -> None:
        self.period = period_sec
        self.callback = callback
        self._next_fire = time.monotonic() + period_sec

    def _maybe_fire(self, now: float) -> None:
        if now >= self._next_fire:
            self._next_fire = now + self.period
            self.callback()


# --------------------------------------------------------------------------- #
# Node
# --------------------------------------------------------------------------- #
class Node:
    def __init__(self, name: str) -> None:
        self.name = name
        self._timers: List[Timer] = []
        self._subs: List[Subscription] = []

    def create_publisher(self, msg_type: Any, topic: str, qos: Any = 10) -> Publisher:
        return Publisher(topic)

    def create_subscription(
        self, msg_type: Any, topic: str, callback: Callable[[Any], None], qos: Any = 10
    ) -> Subscription:
        sub = Subscription(topic, callback)
        self._subs.append(sub)
        return sub

    def create_timer(self, period_sec: float, callback: Callable[[], None]) -> Timer:
        timer = Timer(period_sec, callback)
        self._timers.append(timer)
        return timer

    def get_logger(self):
        return _Logger(self.name)

    def destroy_node(self) -> None:
        self._timers.clear()
        self._subs.clear()


class _Logger:
    def __init__(self, name: str) -> None:
        self._name = name

    def info(self, msg: str) -> None:
        print(f"[INFO] [{self._name}] {msg}", flush=True)

    def warning(self, msg: str) -> None:
        print(f"[WARN] [{self._name}] {msg}", flush=True)

    def error(self, msg: str) -> None:
        print(f"[ERROR] [{self._name}] {msg}", flush=True)


# --------------------------------------------------------------------------- #
# Module-level lifecycle functions mirroring rclpy
# --------------------------------------------------------------------------- #
def init(args: Any = None) -> None:
    global _OK
    _OK = True


def shutdown() -> None:
    global _OK
    _OK = False


def ok() -> bool:
    return _OK


def spin_once(node: Node, timeout_sec: float = 0.1) -> None:
    """Advance timers and sleep up to ``timeout_sec`` (subscriptions fire
    synchronously on publish in this in-memory bus)."""
    now = time.monotonic()
    for timer in node._timers:
        timer._maybe_fire(now)
    if timeout_sec:
        time.sleep(timeout_sec)


# Marker so callers can tell which backend they got.
IS_MOCK = True
