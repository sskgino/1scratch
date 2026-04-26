package ai.scratch.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class MobileCameraPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingUri: Uri? = null

    @Command
    fun capture(invoke: Invoke) {
        val cv = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "scratch_${System.currentTimeMillis()}.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        }
        val uri = activity.contentResolver.insert(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv,
        )
        if (uri == null) {
            invoke.reject("uri_alloc_failed")
            return
        }
        pendingUri = uri
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        startActivityForResult(invoke, intent, "onCapture")
    }

    @ActivityCallback
    fun onCapture(invoke: Invoke, result: ActivityResult) {
        val uri = pendingUri
        pendingUri = null
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("cancelled")
            return
        }
        val path = resolveContentUri(uri)
        invoke.resolve(JSObject().put("path", path))
    }

    private fun resolveContentUri(uri: Uri): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val proj = arrayOf(MediaStore.Images.Media.DATA)
            activity.contentResolver.query(uri, proj, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
                    return c.getString(idx)
                }
            }
        }
        return uri.toString()
    }
}
