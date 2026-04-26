package ai.scratch.app

import android.app.Activity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg class StatusBarArgs { lateinit var theme: String }

@TauriPlugin
class MobileStatusBarPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun set(invoke: Invoke) {
        val a = invoke.parseArgs(StatusBarArgs::class.java)
        activity.runOnUiThread {
            val win = activity.window
            WindowCompat.setDecorFitsSystemWindows(win, false)
            val ctrl = WindowInsetsControllerCompat(win, win.decorView)
            ctrl.isAppearanceLightStatusBars = a.theme == "light"
        }
        invoke.resolve()
    }
}
