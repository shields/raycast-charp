import Carbon
import Foundation

public struct Keystroke: Codable, Equatable, Sendable {
    public let character: String
    public let label: String
    public let modifiers: String
    public let deadKey: DeadKey?

    public struct DeadKey: Codable, Equatable, Sendable {
        public let trigger: String
        public let completion: String
    }
}

enum LayoutError: Error {
    case missingInputSource
    case invalidLayoutData
    case translationFailed(OSStatus)
    case tooManyDeadKeyStates
}

struct Translation {
    let output: String
    let state: UInt32
}

struct Stroke {
    let keyCode: UInt16
    let modifierMask: UInt32
    let modifiers: String
    let keyLabel: String

    var label: String { modifiers + keyLabel }
}

func characterIsVisible(_ text: String) -> Bool {
    guard !text.isEmpty else { return false }
    return text.unicodeScalars.allSatisfy {
        $0.value >= 0x20 && !((0x7f...0x9f).contains($0.value))
            && !((0xf700...0xf8ff).contains($0.value))
    }
}

func enumerateKeystrokes(
    strokes: [Stroke],
    translate: (Stroke, UInt32) throws -> Translation
) throws -> [Keystroke] {
    var result: [UInt32: Keystroke] = [:]
    var states: [(state: UInt32, path: [Stroke])] = [(0, [])]
    var visited: Set<UInt32> = [0]
    var index = 0

    while index < states.count {
        let current = states[index]
        index += 1
        for stroke in strokes {
            let translation = try translate(stroke, current.state)
            // The opaque state can stay nonzero after a completed character is emitted.
            if !translation.output.isEmpty {
                guard translation.output.unicodeScalars.count == 1,
                    let scalar = translation.output.unicodeScalars.first,
                    characterIsVisible(translation.output), result[scalar.value] == nil
                else { continue }
                let path = current.path + [stroke]
                result[scalar.value] = Keystroke(
                    character: translation.output,
                    label: path.map(\.label).joined(separator: " "),
                    modifiers: path[0].modifiers.isEmpty ? "none" : path[0].modifiers,
                    deadKey: current.path.isEmpty
                        ? nil
                        : Keystroke.DeadKey(
                            trigger: current.path.map(\.label).joined(separator: " "),
                            completion: stroke.label
                        )
                )
            } else if visited.insert(translation.state).inserted {
                // Only silent transitions can prefix a character without inserting extra text.
                guard states.count < 1024 else { throw LayoutError.tooManyDeadKeyStates }
                states.append((translation.state, current.path + [stroke]))
            }
        }
    }

    return result.keys.sorted().map { result[$0]! }
}

public func currentKeyboardKeystrokes() throws -> [Keystroke] {
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue() else {
        throw LayoutError.missingInputSource
    }
    return try keyboardKeystrokes(source: source, keyboardType: UInt32(LMGetKbdType()))
}

func keyboardKeystrokes(source: TISInputSource, keyboardType: UInt32) throws -> [Keystroke] {
    guard let property = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else {
        return []
    }
    let data = Unmanaged<CFData>.fromOpaque(property).takeUnretainedValue()
    guard CFDataGetLength(data) >= MemoryLayout<UCKeyboardLayout>.size,
        let bytes = CFDataGetBytePtr(data)
    else { throw LayoutError.invalidLayoutData }
    let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)

    func translate(keyCode: UInt16, modifiers: UInt32, state: UInt32, noDeadKeys: Bool = false)
        throws -> Translation
    {
        var nextState = state
        var length = 0
        var buffer = [UniChar](repeating: 0, count: 255)
        let status = UCKeyTranslate(
            layout, keyCode, UInt16(kUCKeyActionDown), modifiers >> 8, keyboardType,
            noDeadKeys ? OptionBits(kUCKeyTranslateNoDeadKeysMask) : 0,
            &nextState, buffer.count, &length, &buffer
        )
        guard status == noErr else { throw LayoutError.translationFailed(status) }
        return Translation(output: String(utf16CodeUnits: buffer, count: length), state: nextState)
    }

    var keyCodes = Array(UInt16(0)...127)
    let geometry = Int(KBGetLayoutType(Int16(keyboardType)))
    if geometry != Int(kKeyboardISO) { keyCodes.removeAll { $0 == 10 } }
    if geometry != Int(kKeyboardJIS) { keyCodes.removeAll { [93, 94, 95].contains($0) } }

    let keypadCodes: Set<UInt16> = [
        65, 67, 69, 71, 75, 76, 78, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 95,
    ]

    var labels: [UInt16: String] = [:]
    for code in keyCodes {
        let output = try translate(keyCode: code, modifiers: 0, state: 0, noDeadKeys: true).output
        let label = characterIsVisible(output) ? output.uppercased() : "Key\(code)"
        labels[code] = code == 49 ? "Space" : keypadCodes.contains(code) ? "Keypad " + label : label
    }

    let shift = UInt32(shiftKey)
    let option = UInt32(optionKey)
    let caps = UInt32(alphaLock)
    let modifiers: [(UInt32, String)] = [
        (0, ""), (shift, "⇧"), (option, "⌥"), (caps, "⇪"),
        (shift | option, "⇧⌥"), (shift | caps, "⇧⇪"), (option | caps, "⇪⌥"),
        (shift | option | caps, "⇧⇪⌥"),
    ]
    let strokes = modifiers.flatMap { mask, label in
        keyCodes.map { code in
            Stroke(keyCode: code, modifierMask: mask, modifiers: label, keyLabel: labels[code]!)
        }
    }
    return try withExtendedLifetime(data) {
        try enumerateKeystrokes(strokes: strokes) { stroke, state in
            try translate(keyCode: stroke.keyCode, modifiers: stroke.modifierMask, state: state)
        }
    }
}
