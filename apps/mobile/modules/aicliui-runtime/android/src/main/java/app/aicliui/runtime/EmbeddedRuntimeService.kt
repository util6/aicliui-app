package app.aicliui.runtime

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.Executors

internal data class RuntimeStatus(
  val state: String,
  val supported: Boolean,
  val port: Int,
  val pid: Int? = null,
  val detail: String? = null,
  val version: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "state" to state,
    "supported" to supported,
    "port" to port,
    "pid" to pid,
    "detail" to detail,
    "version" to version,
  )

  companion object {
    fun unavailable(port: Int, detail: String) = RuntimeStatus("unavailable", false, port, detail = detail)
    fun stopped(port: Int, detail: String? = null) = RuntimeStatus("stopped", true, port, detail = detail)
    fun starting(port: Int) = RuntimeStatus("starting", true, port, detail = "Starting embedded AionCore")
  }
}

internal data class RuntimePaths(
  val root: File,
  val dataDir: File,
  val workDir: File,
  val logDir: File,
  val logFile: File,
  val executable: File,
) {
  fun prepareDirectories() {
    listOf(root, dataDir, workDir, logDir).forEach { directory ->
      if (!directory.exists() && !directory.mkdirs()) {
        throw IllegalStateException("Unable to create runtime directory: ${directory.absolutePath}")
      }
    }
  }

  companion object {
    fun from(context: Context): RuntimePaths {
      val root = File(context.filesDir, "runtime")
      val logDir = File(root, "logs")
      return RuntimePaths(
        root = root,
        dataDir = File(root, "data"),
        workDir = File(root, "workspaces"),
        logDir = logDir,
        logFile = File(logDir, "aioncore.log"),
        executable = File(context.applicationInfo.nativeLibraryDir, "libaioncore.so"),
      )
    }
  }
}

internal object RuntimeStateStore {
  private const val PREFERENCES = "aicliui_embedded_runtime"

  fun read(context: Context): RuntimeStatus {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    return RuntimeStatus(
      state = preferences.getString("state", "stopped") ?: "stopped",
      supported = preferences.getBoolean("supported", false),
      port = preferences.getInt("port", 43117),
      pid = preferences.getInt("pid", 0).takeIf { it > 0 },
      detail = preferences.getString("detail", null),
    )
  }

  fun write(context: Context, status: RuntimeStatus) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString("state", status.state)
      .putBoolean("supported", status.supported)
      .putInt("port", status.port)
      .putInt("pid", status.pid ?: 0)
      .putString("detail", status.detail)
      .apply()
  }
}

class EmbeddedRuntimeService : Service() {
  private val executor = Executors.newSingleThreadExecutor()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopRuntime()
      ACTION_START -> startRuntime(intent.getIntExtra(EXTRA_PORT, 43117))
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    destroyProcess()
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun startRuntime(port: Int) {
    startForeground(NOTIFICATION_ID, buildNotification("Starting local agent runtime"))
    synchronized(PROCESS_LOCK) {
      if (runtimeProcess?.let(::isAlive) == true) {
        RuntimeStateStore.write(this, runningStatus(port))
        updateNotification("Local agent runtime is running")
        return
      }
      runtimeStarting = true
    }

    executor.execute {
      val paths = RuntimePaths.from(this)
      try {
        paths.prepareDirectories()
        val command = listOf(
          paths.executable.absolutePath,
          "--local",
          "--host", "127.0.0.1",
          "--port", port.toString(),
          "--data-dir", paths.dataDir.absolutePath,
          "--work-dir", paths.workDir.absolutePath,
          "--log-dir", paths.logDir.absolutePath,
          "--managed-resources-mode", "download",
        )
        val process = ProcessBuilder(command)
          .directory(paths.root)
          .redirectErrorStream(true)
          .redirectOutput(ProcessBuilder.Redirect.appendTo(paths.logFile))
          .apply {
            environment()["HOME"] = paths.root.absolutePath
            environment()["AICLIUI_HOME"] = paths.root.absolutePath
          }
          .start()

        synchronized(PROCESS_LOCK) {
          runtimeProcess = process
          runtimeStarting = false
        }
        RuntimeStateStore.write(this, runningStatus(port))
        updateNotification("Local agent runtime is running")

        val exitCode = process.waitFor()
        synchronized(PROCESS_LOCK) {
          if (runtimeProcess === process) runtimeProcess = null
          runtimeStarting = false
        }
        val detail = if (exitCode == 0) "Embedded runtime stopped" else "AionCore exited with code $exitCode"
        val state = if (exitCode == 0) "stopped" else "error"
        RuntimeStateStore.write(this, RuntimeStatus(state, true, port, detail = detail))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      } catch (error: Throwable) {
        synchronized(PROCESS_LOCK) {
          runtimeStarting = false
        }
        RuntimeStateStore.write(
          this,
          RuntimeStatus("error", true, port, detail = error.message ?: "Unable to start embedded runtime"),
        )
        updateNotification("Local agent runtime failed to start")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
  }

  private fun stopRuntime() {
    destroyProcess()
    val port = RuntimeStateStore.read(this).port
    RuntimeStateStore.write(this, RuntimeStatus.stopped(port, "Embedded runtime stopped"))
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun destroyProcess() {
    synchronized(PROCESS_LOCK) {
      runtimeProcess?.destroy()
      runtimeProcess = null
      runtimeStarting = false
    }
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "AICLIUI runtime", NotificationManager.IMPORTANCE_LOW),
    )
  }

  private fun buildNotification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.stat_notify_sync)
    .setContentTitle("AICLIUI")
    .setContentText(text)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .build()

  private fun updateNotification(text: String) {
    val manager = getSystemService(NotificationManager::class.java)
    manager.notify(NOTIFICATION_ID, buildNotification(text))
  }

  private fun runningStatus(port: Int): RuntimeStatus =
    RuntimeStatus("running", true, port, detail = "AionCore is running")

  private fun isAlive(process: Process): Boolean = try {
    process.exitValue()
    false
  } catch (_: IllegalThreadStateException) {
    true
  }

  companion object {
    const val ACTION_START = "app.aicliui.runtime.action.START"
    const val ACTION_STOP = "app.aicliui.runtime.action.STOP"
    const val EXTRA_PORT = "port"
    private const val CHANNEL_ID = "aicliui_runtime"
    private const val NOTIFICATION_ID = 43117
    private val PROCESS_LOCK = Any()
    private var runtimeProcess: Process? = null
    private var runtimeStarting = false

    internal fun isRuntimeActive(): Boolean = synchronized(PROCESS_LOCK) {
      runtimeStarting || runtimeProcess?.let { process ->
        try {
          process.exitValue()
          false
        } catch (_: IllegalThreadStateException) {
          true
        }
      } == true
    }
  }
}
