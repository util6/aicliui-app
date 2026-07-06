package app.aicliui.termux

import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TERMUX_PACKAGE = "com.termux"
private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
private const val RUN_COMMAND_ACTION = "com.termux.RUN_COMMAND"
private const val RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND"
private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
private const val EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN"
private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
private const val EXTRA_COMMAND_LABEL = "com.termux.RUN_COMMAND_COMMAND_LABEL"

class AicliuiTermuxModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AicliuiTermux")

    AsyncFunction<Boolean>("isTermuxInstalledAsync") {
      isPackageInstalled(TERMUX_PACKAGE)
    }

    AsyncFunction<Boolean>("hasRunCommandPermissionAsync") {
      val context = appContext.reactContext ?: throw TermuxUnavailableException("React context is unavailable")
      context.checkSelfPermission(RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction<Boolean>("openTermuxAppAsync") {
      val context = appContext.reactContext ?: throw TermuxUnavailableException("React context is unavailable")
      val intent = context.packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE)
        ?: return@AsyncFunction false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction<Boolean>("runCommandAsync") {
      commandPath: String,
      arguments: List<String>,
      stdin: String?,
      workdir: String?,
      background: Boolean,
      label: String? ->
      val context = appContext.reactContext ?: throw TermuxUnavailableException("React context is unavailable")
      if (!isPackageInstalled(TERMUX_PACKAGE)) {
        throw TermuxUnavailableException("Termux is not installed")
      }
      if (context.checkSelfPermission(RUN_COMMAND_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
        throw TermuxPermissionException()
      }

      val intent = Intent().apply {
        setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE)
        action = RUN_COMMAND_ACTION
        putExtra(EXTRA_COMMAND_PATH, commandPath)
        putExtra(EXTRA_ARGUMENTS, arguments.toTypedArray())
        putExtra(EXTRA_BACKGROUND, background)
        stdin?.let { putExtra(EXTRA_STDIN, it) }
        workdir?.let { putExtra(EXTRA_WORKDIR, it) }
        label?.let { putExtra(EXTRA_COMMAND_LABEL, it) }
      }
      context.startService(intent)
      true
    }
  }

  private fun isPackageInstalled(packageName: String): Boolean {
    val context = appContext.reactContext ?: return false
    return try {
      context.packageManager.getPackageInfo(packageName, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }
}

private class TermuxUnavailableException(message: String) : CodedException(message)

private class TermuxPermissionException : CodedException(
  "Missing com.termux.permission.RUN_COMMAND permission"
)
