import assert from "node:assert/strict";
import { resolveTerminalKeySequence, TERMINAL_KEY_SEQUENCES } from "../public/js/views/terminal.js";

// Cmd + ArrowLeft -> Ctrl+A (\x01)
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowLeft", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.HOME
);

// Cmd + ArrowRight -> Ctrl+E (\x05)
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowRight", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.END
);

// Option/Alt + ArrowLeft -> Esc b (\x1bb)
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowLeft", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_BACK
);

// Option/Alt + ArrowRight -> Esc f (\x1bf)
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowRight", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_FWD
);

// WebKit fallback via e.code when e.key altered or missing
assert.equal(
  resolveTerminalKeySequence({ key: "Unidentified", code: "ArrowLeft", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_BACK
);
assert.equal(
  resolveTerminalKeySequence({ key: "Unidentified", code: "ArrowRight", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_FWD
);
assert.equal(
  resolveTerminalKeySequence({ key: "Unidentified", code: "ArrowLeft", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.HOME
);
assert.equal(
  resolveTerminalKeySequence({ key: "Unidentified", code: "ArrowRight", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.END
);

// Key alias "Left" / "Right" legacy support
assert.equal(
  resolveTerminalKeySequence({ key: "Left", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_BACK
);
assert.equal(
  resolveTerminalKeySequence({ key: "Right", metaKey: false, altKey: true, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.WORD_FWD
);
assert.equal(
  resolveTerminalKeySequence({ key: "Left", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.HOME
);
assert.equal(
  resolveTerminalKeySequence({ key: "Right", metaKey: true, altKey: false, ctrlKey: false }),
  TERMINAL_KEY_SEQUENCES.END
);

// getModifierState("Alt") support
assert.equal(
  resolveTerminalKeySequence({
    key: "ArrowLeft",
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    getModifierState: (mod) => mod === "Alt"
  }),
  TERMINAL_KEY_SEQUENCES.WORD_BACK
);
assert.equal(
  resolveTerminalKeySequence({
    key: "ArrowRight",
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    getModifierState: (mod) => mod === "Alt"
  }),
  TERMINAL_KEY_SEQUENCES.WORD_FWD
);

// Plain arrows and other modifiers should return null
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowLeft", metaKey: false, altKey: false, ctrlKey: false }),
  null
);
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowRight", metaKey: false, altKey: false, ctrlKey: false }),
  null
);
assert.equal(
  resolveTerminalKeySequence({ key: "ArrowLeft", metaKey: true, altKey: true, ctrlKey: false }),
  null
);

console.log("Terminal keybinding assertions passed.");
