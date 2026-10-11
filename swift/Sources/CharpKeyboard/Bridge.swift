import Foundation
import KeyboardLayout
import RaycastSwiftMacros

@raycast func systemKeystrokes() throws -> String {
    let keystrokes = try currentKeyboardKeystrokes()
    return String(decoding: try JSONEncoder().encode(keystrokes), as: UTF8.self)
}
