package ai.scratch.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    registerPlugin(MobileHapticPlugin::class.java)
    registerPlugin(MobileCameraPlugin::class.java)
  }
}
