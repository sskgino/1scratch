package app.scratch.securestore

import android.app.Activity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class GetArgs { lateinit var key: String }

@InvokeArg
class SetArgs {
    lateinit var key: String
    lateinit var value: String
}

@TauriPlugin
class SecureStorePlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs by lazy {
        val mk = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            activity,
            "scratch_secure",
            mk,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @Command
    fun get(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        val v = prefs.getString(args.key, null)
        val out = JSObject()
        if (v != null) out.put("value", v) else out.put("value", JSONObject.NULL)
        invoke.resolve(out)
    }

    @Command
    fun set(invoke: Invoke) {
        val args = invoke.parseArgs(SetArgs::class.java)
        prefs.edit().putString(args.key, args.value).apply()
        invoke.resolve()
    }

    @Command
    fun delete(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        prefs.edit().remove(args.key).apply()
        invoke.resolve()
    }

    @Command
    fun has(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        invoke.resolve(JSObject().put("value", prefs.contains(args.key)))
    }
}
