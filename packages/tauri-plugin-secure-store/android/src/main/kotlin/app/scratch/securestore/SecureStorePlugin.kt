package app.scratch.securestore

import android.app.Activity
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

private const val PREFS_FILE = "scratch_secure"

@InvokeArg
class GetArgs { lateinit var key: String }

@InvokeArg
class SetArgs {
    lateinit var key: String
    lateinit var value: String
}

@TauriPlugin
class SecureStorePlugin(private val activity: Activity) : Plugin(activity) {
    private var _prefs: SharedPreferences? = null
    private val prefs: SharedPreferences get() = _prefs ?: openPrefs().also { _prefs = it }

    private fun openPrefs(): SharedPreferences {
        val mk = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return try {
            EncryptedSharedPreferences.create(
                activity,
                PREFS_FILE,
                mk,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            // Ciphertext authenticated with a key that no longer exists (keystore
            // reset, auto-backup restore after reinstall, etc.). Wipe the file and
            // retry with a fresh key — the prior session is unrecoverable anyway.
            activity.deleteSharedPreferences(PREFS_FILE)
            EncryptedSharedPreferences.create(
                activity,
                PREFS_FILE,
                mk,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }

    private inline fun <T> withPrefs(op: (SharedPreferences) -> T): T = try {
        op(prefs)
    } catch (e: Exception) {
        _prefs = null
        activity.deleteSharedPreferences(PREFS_FILE)
        op(prefs)
    }

    @Command
    fun get(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        val v = withPrefs { it.getString(args.key, null) }
        val out = JSObject()
        if (v != null) out.put("value", v) else out.put("value", JSONObject.NULL)
        invoke.resolve(out)
    }

    @Command
    fun set(invoke: Invoke) {
        val args = invoke.parseArgs(SetArgs::class.java)
        withPrefs { it.edit().putString(args.key, args.value).apply() }
        invoke.resolve()
    }

    @Command
    fun delete(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        withPrefs { it.edit().remove(args.key).apply() }
        invoke.resolve()
    }

    @Command
    fun has(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        invoke.resolve(JSObject().put("value", withPrefs { it.contains(args.key) }))
    }
}
