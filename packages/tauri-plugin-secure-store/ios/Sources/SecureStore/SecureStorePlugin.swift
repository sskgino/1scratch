import SwiftRs
import Tauri
import UIKit
import WebKit
import Security

class GetArgs: Decodable { let key: String }
class SetArgs: Decodable { let key: String; let value: String }

class SecureStorePlugin: Plugin {
  private let service = "ai.scratch.app.secure-store"

  @objc public func get(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound {
      invoke.resolve(["value": NSNull()])
      return
    }
    guard status == errSecSuccess, let data = out as? Data, let value = String(data: data, encoding: .utf8) else {
      invoke.reject("keychain read failed (\(status))")
      return
    }
    invoke.resolve(["value": value])
  }

  @objc public func set(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetArgs.self)
    let value = args.value.data(using: .utf8) ?? Data()
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
    ]
    SecItemDelete(q as CFDictionary)
    var add = q
    add[kSecValueData as String] = value
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecSuccess { invoke.resolve() } else { invoke.reject("keychain write failed (\(status))") }
  }

  @objc public func delete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
    ]
    SecItemDelete(q as CFDictionary)
    invoke.resolve()
  }

  @objc public func has(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    let status = SecItemCopyMatching(q as CFDictionary, nil)
    invoke.resolve(["value": status == errSecSuccess])
  }
}

@_cdecl("init_plugin_secure_store")
func initPlugin() -> Plugin { return SecureStorePlugin() }
