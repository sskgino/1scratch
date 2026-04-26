package ai.scratch.app

import android.app.Activity
import android.os.Build
import android.os.VibrationEffect
import android.os.VibratorManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg class HapticArgs { lateinit var kind: String }

@TauriPlugin
class MobileHapticPlugin(private val activity: Activity) : Plugin(activity) {
    private val vibrator by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (activity.getSystemService(Activity.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Activity.VIBRATOR_SERVICE) as android.os.Vibrator
        }
    }

    @Command
    fun trigger(invoke: Invoke) {
        val a = invoke.parseArgs(HapticArgs::class.java)
        val durationMs = when (a.kind) {
            "light"   -> 10L
            "medium"  -> 30L
            "success" -> 80L
            "warning" -> 130L
            else -> { invoke.reject("unknown kind"); return }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val effect = when (a.kind) {
                "light" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                else
                    VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                "medium" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                else
                    VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                "success" -> VibrationEffect.createWaveform(longArrayOf(0, 30, 50, 30), -1)
                "warning" -> VibrationEffect.createWaveform(longArrayOf(0, 50, 80, 50), -1)
                else -> { invoke.reject("unknown kind"); return }
            }
            vibrator.vibrate(effect)
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(durationMs)
        }
        invoke.resolve()
    }
}
