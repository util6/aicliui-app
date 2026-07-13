package app.aicliui.runtime

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

private const val DEFAULT_RUNTIME_PORT = 43117

class AicliuiRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AicliuiRuntime")

    AsyncFunction<Map<String, Any?>>("getStatusAsync") {
      val context = appContext.reactContext
        ?: throw RuntimeUnavailableException("React context is unavailable")
      val paths = RuntimePaths.from(context)
      val persisted = RuntimeStateStore.read(context)
      val status = when {
        !paths.executable.isFile || !paths.executable.canExecute() ->
          RuntimeStatus.unavailable(persisted.port, "Embedded AionCore binary is missing")
        persisted.state in setOf("running", "starting") && !EmbeddedRuntimeService.isRuntimeActive() ->
          RuntimeStatus.stopped(persisted.port, "Embedded AionCore is ready")
        !persisted.supported -> RuntimeStatus.stopped(persisted.port, "Embedded AionCore is ready")
        else -> persisted
      }
      RuntimeStateStore.write(context, status)
      statusWithMetadata(context, status).toMap()
    }

    AsyncFunction<Map<String, Any?>>("prepareAsync") {
      val context = appContext.reactContext
        ?: throw RuntimeUnavailableException("React context is unavailable")
      val paths = RuntimePaths.from(context)
      paths.prepareDirectories()
      val status = if (EmbeddedRuntimeService.isRuntimeActive()) {
        RuntimeStateStore.read(context)
      } else if (paths.executable.isFile && paths.executable.canExecute()) {
        RuntimeStatus.stopped(DEFAULT_RUNTIME_PORT, "Embedded AionCore is ready")
      } else {
        RuntimeStatus.unavailable(DEFAULT_RUNTIME_PORT, "Embedded AionCore binary is missing")
      }
      RuntimeStateStore.write(context, status)
      statusWithMetadata(context, status).toMap()
    }

    AsyncFunction("startAsync") { port: Int ->
      val context = appContext.reactContext
        ?: throw RuntimeUnavailableException("React context is unavailable")
      if (port !in 1..65535) throw InvalidRuntimePortException(port)

      val paths = RuntimePaths.from(context)
      paths.prepareDirectories()
      if (!paths.executable.isFile || !paths.executable.canExecute()) {
        val status = RuntimeStatus.unavailable(port, "Embedded AionCore binary is missing")
        RuntimeStateStore.write(context, status)
        return@AsyncFunction statusWithMetadata(context, status).toMap()
      }

      val status = RuntimeStatus.starting(port)
      RuntimeStateStore.write(context, status)
      val intent = Intent(context, EmbeddedRuntimeService::class.java).apply {
        action = EmbeddedRuntimeService.ACTION_START
        putExtra(EmbeddedRuntimeService.EXTRA_PORT, port)
      }
      ContextCompat.startForegroundService(context, intent)
      statusWithMetadata(context, status).toMap()
    }

    AsyncFunction<Map<String, Any?>>("stopAsync") {
      val context = appContext.reactContext
        ?: throw RuntimeUnavailableException("React context is unavailable")
      val current = RuntimeStateStore.read(context)
      context.stopService(Intent(context, EmbeddedRuntimeService::class.java))
      val status = RuntimeStatus.stopped(current.port, "Embedded runtime stopped")
      RuntimeStateStore.write(context, status)
      statusWithMetadata(context, status).toMap()
    }

    AsyncFunction<String>("getLogPathAsync") {
      val context = appContext.reactContext
        ?: throw RuntimeUnavailableException("React context is unavailable")
      RuntimePaths.from(context).logFile.absolutePath
    }
  }
}

private fun statusWithMetadata(context: android.content.Context, status: RuntimeStatus): RuntimeStatus {
  val version = try {
    context.assets.open("aicliui-runtime.json").bufferedReader().use { reader ->
      JSONObject(reader.readText()).optString("version").takeIf { it.isNotBlank() }
    }
  } catch (_: Exception) {
    null
  }
  return status.copy(version = version)
}

private class RuntimeUnavailableException(message: String) : CodedException(message)

private class InvalidRuntimePortException(port: Int) : CodedException(
  "Invalid embedded runtime port: $port"
)
