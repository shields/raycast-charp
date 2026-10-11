import Carbon
import Foundation
import Testing
@testable import KeyboardLayout

@Suite(.serialized)
struct KeyboardLayoutTests {
    @MainActor
    private func source(_ properties: [String: String]) throws -> TISInputSource {
        let sources = TISCreateInputSourceList(properties as CFDictionary, true).takeRetainedValue()
        let array = sources as! [TISInputSource]
        return try #require(array.first)
    }

    @MainActor
    private func layout(_ id: String) throws -> [String: Keystroke] {
        let input = try source([kTISPropertyInputSourceID as String: id])
        let entries = try keyboardKeystrokes(source: input, keyboardType: 40)
        return Dictionary(uniqueKeysWithValues: entries.map { ($0.character, $0) })
    }

    @Test @MainActor
    func usModifiersAndDeadKeys() throws {
        let map = try layout("com.apple.keylayout.US")
        #expect(map["a"]?.label == "A")
        #expect(map["A"]?.label == "⇧A")
        #expect(map["@"]?.label == "⇧2")
        #expect(map["€"]?.label == "⇧⌥2")
        #expect(map["é"]?.label == "⌥E E")
        #expect(map["É"]?.label == "⌥E ⇧E")
        #expect(map["é"]?.deadKey == Keystroke.DeadKey(trigger: "⌥E", completion: "E"))
        #expect(map[" "]?.label == "Space")
        #expect(map["\r"] == nil)
        #expect(map["\u{F700}"] == nil)
    }

    @Test @MainActor
    func germanAndFrenchLayouts() throws {
        let german = try layout("com.apple.keylayout.German")
        let french = try layout("com.apple.keylayout.French")
        #expect(german["@"]?.label == "⌥L")
        #expect(german["ü"]?.modifiers == "none")
        #expect(french["é"]?.modifiers == "none")
        #expect(french["é"]?.deadKey == nil)
    }

    @Test @MainActor
    func activeLayout() throws {
        #expect(!(try currentKeyboardKeystrokes()).isEmpty)
    }

    @Test @MainActor
    func customLayout() throws {
        let fixture = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test/fixtures/test.keylayout")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            #expect(throws: Never.self) { try FileManager.default.removeItem(at: directory) }
        }
        let name = "CharpTest" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let file = directory.appendingPathComponent(name + ".keylayout")
        let xml = try String(contentsOf: fixture, encoding: .utf8)
            .replacingOccurrences(of: "name=\"Test\"", with: "name=\"\(name)\"")
            .replacingOccurrences(of: "<key code=\"2\" output=\"d\"/>", with: "<key code=\"2\" output=\"\"/>")
            .replacingOccurrences(of: "<keyMap index=\"3\">", with: "<keyMap index=\"3\"><key code=\"2\" output=\"∂\"/>")
        try xml.write(to: file, atomically: true, encoding: .utf8)
        #expect(TISRegisterInputSource(file as CFURL) == noErr)
        let input = try source([kTISPropertyLocalizedName as String: name])
        let entries = try keyboardKeystrokes(source: input, keyboardType: 40)
        let map = Dictionary(uniqueKeysWithValues: entries.map { ($0.character, $0) })
        #expect(map["α"]?.label == "⌥A")
        #expect(map["π"]?.label == "⌥P")
        #expect(map["Ç"]?.label == "⇧⌥C")
        #expect(map["é"]?.label == "⌥E E")
        #expect(map["Á"]?.label == "⌥E ⇧A")
        #expect(map["∂"]?.label == "⌥Key2")
    }

    @Test
    func shortestPathsAndCycles() throws {
        let strokes = [
            Stroke(keyCode: 0, modifierMask: 0, modifiers: "", keyLabel: "A"),
            Stroke(keyCode: 1, modifierMask: 0, modifiers: "", keyLabel: "É"),
            Stroke(keyCode: 0, modifierMask: 512, modifiers: "⇧", keyLabel: "A"),
            Stroke(keyCode: 14, modifierMask: 2048, modifiers: "⌥", keyLabel: "E"),
        ]
        let entries = try enumerateKeystrokes(strokes: strokes) { stroke, state in
            switch (state, stroke.keyCode, stroke.modifierMask) {
            case (0, 0, 0): Translation(output: "a", state: 0)
            case (0, 1, 0): Translation(output: "é", state: 0)
            case (0, 14, 2048): Translation(output: "", state: 1)
            case (1, 14, 2048): Translation(output: "", state: 2)
            case (1, 0, 0): Translation(output: "é", state: 0)
            case (1, 0, 512): Translation(output: "Á", state: 0)
            case (2, 14, 2048): Translation(output: "", state: 1)
            case (2, 0, 0): Translation(output: "ấ", state: 0)
            default: Translation(output: "", state: 0)
            }
        }
        let map = Dictionary(uniqueKeysWithValues: entries.map { ($0.character, $0) })
        #expect(map["é"]?.label == "É")
        #expect(map["é"]?.deadKey == nil)
        #expect(map["Á"]?.label == "⌥E ⇧A")
        #expect(map["ấ"]?.label == "⌥E ⌥E A")
    }

    @Test
    func ignoresExtraOutputAndPendingState() throws {
        let stroke = Stroke(keyCode: 0, modifierMask: 0, modifiers: "", keyLabel: "A")
        for output in ["ab", "\r", "\u{0080}", "\u{F700}"] {
            let entries = try enumerateKeystrokes(strokes: [stroke]) { _, _ in
                Translation(output: output, state: 0)
            }
            #expect(entries.isEmpty)
        }
        let entries = try enumerateKeystrokes(strokes: [stroke]) { _, state in
            #expect(state == 0)
            return Translation(output: "a", state: 1)
        }
        #expect(entries.isEmpty)
        #expect(!characterIsVisible(""))
        #expect(characterIsVisible("𝔸"))
    }

    @Test
    func canonicallyEquivalentCodePointsStayDistinct() throws {
        let strokes = [
            Stroke(keyCode: 0, modifierMask: 0, modifiers: "", keyLabel: "A"),
            Stroke(keyCode: 1, modifierMask: 0, modifiers: "", keyLabel: "S"),
        ]
        let entries = try enumerateKeystrokes(strokes: strokes) { stroke, _ in
            Translation(output: stroke.keyCode == 0 ? "Å" : "Å", state: 0)
        }
        #expect(entries.map { $0.character.unicodeScalars.first!.value } == [0xc5, 0x212b])
    }

    @Test
    func nativeErrorsPropagate() {
        let stroke = Stroke(keyCode: 0, modifierMask: 0, modifiers: "", keyLabel: "A")
        #expect(throws: LayoutError.self) {
            try enumerateKeystrokes(strokes: [stroke]) { _, _ in
                throw LayoutError.translationFailed(-50)
            }
        }
        #expect(throws: LayoutError.self) {
            try enumerateKeystrokes(strokes: [stroke]) { _, state in
                Translation(output: "", state: state + 1)
            }
        }
    }
}
