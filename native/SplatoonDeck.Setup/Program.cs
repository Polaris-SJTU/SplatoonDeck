using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Linq;
using System.Management;
using System.Net;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("SplatoonDeck Setup Helper")]
[assembly: System.Reflection.AssemblyDescription("Native environment manager bundled with SplatoonDeck")]
[assembly: System.Reflection.AssemblyProduct("SplatoonDeck")]
[assembly: System.Reflection.AssemblyCompany("SplatoonDeck contributors")]
[assembly: System.Reflection.AssemblyVersion("0.3.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.3.0.0")]

namespace SplatoonDeck.Setup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                var options = Options.Parse(args);
                if (options.Action == "self-test") return RunSelfTest(options);
                if (!options.Elevated) return RelaunchElevated(options);
                if (!IsAdministrator()) throw new UnauthorizedAccessException("Administrator permission was not granted.");
                OpenProgressConsole();
                Console.OutputEncoding = new UTF8Encoding(false);
                var actionTitle = options.Action == "uninstall" ? "Uninstalling dependencies" : options.Action == "usbipd" ? "Updating Bluetooth access" : "Installing dependencies";
                Console.Title = "SplatoonDeck - " + actionTitle;
                using (var log = new Logger(options.LogPath))
                {
                    try
                    {
                        log.Line("SplatoonDeck - " + actionTitle, ConsoleColor.Cyan);
                        log.Line("Keep this window open while the operation is running.", ConsoleColor.DarkGray);
                        log.Line("");
                        using (var operation = OperationGuard.Acquire(options.Action))
                        {
                            EnsureWindowsServicingIsIdle(options.Action);
                            var workflow = new DependencyWorkflow(options, log);
                            if (options.Action == "uninstall") workflow.Uninstall();
                            else if (options.Action == "usbipd") workflow.RunUsbipd(options.UsbipdPath, options.UsbipdArguments());
                            else workflow.Install();
                        }
                        log.Line("");
                        var completed = options.Action == "uninstall" ? "Dependency cleanup completed." : options.Action == "usbipd" ? "Bluetooth access updated." : "Dependency setup completed.";
                        if (options.Action == "install" && new StateStore(options.StatePath).Bool("restartRequired"))
                            completed = "Prerequisite stage completed. Restart Windows to continue setup.";
                        log.Line("[DONE] " + completed, ConsoleColor.Green);
                        log.Line("Log: " + options.LogPath, ConsoleColor.DarkGray);
                        Thread.Sleep(2000);
                        return 0;
                    }
                    catch (Exception error)
                    {
                        log.Line("");
                        log.Line("[FAILED] The operation could not be completed.", ConsoleColor.Red);
                        log.Line(error.ToString(), ConsoleColor.Red);
                        log.Line("Log: " + options.LogPath, ConsoleColor.Yellow);
                        log.Line("");
                        Console.Write("Press Enter to close this window: ");
                        Console.ReadLine();
                        return 1;
                    }
                }
            }
            catch (Exception error)
            {
                try { Console.Error.WriteLine(error); } catch { }
                return 1;
            }
        }

        private static int RelaunchElevated(Options options)
        {
            if (IsAdministrator()) return Main(options.WithElevatedArguments());
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = Process.GetCurrentProcess().MainModule.FileName,
                    Arguments = options.ToCommandLine(true),
                    UseShellExecute = true,
                    Verb = "runas",
                    WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
                };
                using (var process = Process.Start(info))
                {
                    if (process == null) return 1;
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
            catch (Win32Exception error)
            {
                return error.NativeErrorCode == 1223 ? 1223 : 1;
            }
        }

        private static bool IsAdministrator()
        {
            using (var identity = WindowsIdentity.GetCurrent())
            {
                return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
        }

        private static void EnsureWindowsServicingIsIdle(string action)
        {
            if (action != "install" && action != "uninstall") return;
            var active = Process.GetProcessesByName("dism").Concat(Process.GetProcessesByName("DismHost")).ToArray();
            try
            {
                if (active.Length > 0) throw new InvalidOperationException("Another Windows component operation is still running. Close other setup windows, restart Windows, then retry.");
            }
            finally
            {
                foreach (var process in active) process.Dispose();
            }
        }

        private static void OpenProgressConsole()
        {
            NativeMethods.AllocConsole();
            NativeMethods.SetConsoleOutputCP(65001);
            var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            Console.SetOut(output);
            Console.SetError(output);
            Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        }

        private static class NativeMethods
        {
            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool AllocConsole();

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool SetConsoleOutputCP(uint codePage);
        }

        private static int RunSelfTest(Options options)
        {
            using (var log = new Logger(options.LogPath))
            {
                log.Line("SplatoonDeck native helper self-test", ConsoleColor.Cyan);
                var command = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
                var runner = new CommandRunner(log);
                var result = runner.Run(command, "/d /c echo Native command output ready");
                if (result.ExitCode != 0 || result.Output.IndexOf("Native command output ready", StringComparison.Ordinal) < 0) return 1;
                var timeout = runner.Run(command, "/d /c ping -n 6 127.0.0.1 >nul", true, 250);
                if (!timeout.TimedOut) return 1;
                log.Line("Self-test passed.", ConsoleColor.Green);
                return 0;
            }
        }
    }

    internal sealed class OperationGuard : IDisposable
    {
        private readonly Mutex mutex;
        private readonly bool owned;

        private OperationGuard(Mutex mutex, bool owned) { this.mutex = mutex; this.owned = owned; }

        public static OperationGuard Acquire(string action)
        {
            if (action == "usbipd" || action == "self-test") return new OperationGuard(null, false);
            var mutex = new Mutex(false, "SplatoonDeck.DependencySetup");
            var acquired = false;
            try { acquired = mutex.WaitOne(0, false); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired)
            {
                mutex.Dispose();
                throw new InvalidOperationException("Another SplatoonDeck setup or cleanup operation is already running.");
            }
            return new OperationGuard(mutex, true);
        }

        public void Dispose()
        {
            if (mutex == null) return;
            if (owned) { try { mutex.ReleaseMutex(); } catch { } }
            mutex.Dispose();
        }
    }

    internal static class ChildProcessJob
    {
        private const uint KillOnJobClose = 0x00002000;
        private static readonly IntPtr Handle = CreateKillOnCloseJob();

        public static void Assign(Process process)
        {
            if (Handle == IntPtr.Zero || process == null) return;
            NativeMethods.AssignProcessToJobObject(Handle, process.Handle);
        }

        private static IntPtr CreateKillOnCloseJob()
        {
            var handle = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) return IntPtr.Zero;
            var information = new JobObjectExtendedLimitInformation();
            information.BasicLimitInformation.LimitFlags = KillOnJobClose;
            var length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
            var pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(information, pointer, false);
                if (!NativeMethods.SetInformationJobObject(handle, 9, pointer, (uint)length))
                {
                    NativeMethods.CloseHandle(handle);
                    return IntPtr.Zero;
                }
                return handle;
            }
            finally { Marshal.FreeHGlobal(pointer); }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private static class NativeMethods
        {
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            public static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);
        }
    }

    internal sealed class Options
    {
        public string Action;
        public string StatePath;
        public string SessionPath;
        public string LinuxSetupPath;
        public string LogPath;
        public string UsbipdPath;
        public string UsbipdArgumentsBase64;
        public bool Elevated;

        public static Options Parse(string[] args)
        {
            if (args.Length == 0 || (args[0] != "install" && args[0] != "uninstall" && args[0] != "usbipd" && args[0] != "self-test")) throw new ArgumentException("Expected install, uninstall, usbipd, or self-test action.");
            var result = new Options { Action = args[0] };
            for (var index = 1; index < args.Length; index++)
            {
                if (args[index] == "--elevated") { result.Elevated = true; continue; }
                if (index + 1 >= args.Length) throw new ArgumentException("Missing value for " + args[index]);
                var value = args[++index];
                if (args[index - 1] == "--state") result.StatePath = value;
                else if (args[index - 1] == "--session") result.SessionPath = value;
                else if (args[index - 1] == "--linux-setup") result.LinuxSetupPath = value;
                else if (args[index - 1] == "--log") result.LogPath = value;
                else if (args[index - 1] == "--usbipd") result.UsbipdPath = value;
                else if (args[index - 1] == "--usbipd-args") result.UsbipdArgumentsBase64 = value;
                else throw new ArgumentException("Unknown option " + args[index - 1]);
            }
            if (String.IsNullOrWhiteSpace(result.StatePath) || String.IsNullOrWhiteSpace(result.LogPath)) throw new ArgumentException("State and log paths are required.");
            return result;
        }

        public string[] WithElevatedArguments()
        {
            var values = BaseArguments();
            values.Add("--elevated");
            return values.ToArray();
        }

        public string ToCommandLine(bool elevated)
        {
            var values = BaseArguments();
            if (elevated) values.Add("--elevated");
            return String.Join(" ", values.Select(CommandRunner.QuoteArgument));
        }

        private List<string> BaseArguments()
        {
            var values = new List<string> { Action, "--state", StatePath, "--session", SessionPath ?? "", "--linux-setup", LinuxSetupPath ?? "", "--log", LogPath };
            if (!String.IsNullOrWhiteSpace(UsbipdPath)) { values.Add("--usbipd"); values.Add(UsbipdPath); }
            if (!String.IsNullOrWhiteSpace(UsbipdArgumentsBase64)) { values.Add("--usbipd-args"); values.Add(UsbipdArgumentsBase64); }
            return values;
        }

        public string[] UsbipdArguments()
        {
            if (String.IsNullOrWhiteSpace(UsbipdArgumentsBase64)) return new string[0];
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(UsbipdArgumentsBase64));
            return new JavaScriptSerializer().Deserialize<string[]>(json) ?? new string[0];
        }
    }

    internal sealed class Logger : IDisposable
    {
        private readonly StreamWriter writer;
        private readonly object gate = new object();

        public Logger(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            writer = new StreamWriter(path, false, new UTF8Encoding(false)) { AutoFlush = true };
        }

        public void Line(string value) { Line(value, null); }

        public void Line(string value, ConsoleColor? color)
        {
            lock (gate)
            {
                try
                {
                    if (color.HasValue) Console.ForegroundColor = color.Value;
                    Console.WriteLine(value ?? "");
                    if (color.HasValue) Console.ResetColor();
                }
                catch { }
                writer.WriteLine(value ?? "");
            }
        }

        public void Dispose() { writer.Dispose(); }
    }

    internal sealed class CommandResult
    {
        public int ExitCode;
        public string Output;
        public bool TimedOut;
    }

    internal sealed class CommandRunner
    {
        private readonly Logger log;

        public CommandRunner(Logger log) { this.log = log; }

        public CommandResult Run(string file, string arguments, bool allowFailure, int timeoutMilliseconds)
        {
            log.Line("  $ " + Path.GetFileName(file) + " " + arguments, ConsoleColor.DarkGray);
            var output = new StringBuilder();
            var info = new ProcessStartInfo
            {
                FileName = file,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = OutputEncodingFor(file, arguments),
                StandardErrorEncoding = OutputEncodingFor(file, arguments)
            };
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { RecordLine(output, eventArgs.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { RecordLine(output, eventArgs.Data); };
                if (!process.Start()) throw new InvalidOperationException("Could not start " + file);
                ChildProcessJob.Assign(process);
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.StandardInput.Close();
                var elapsed = Stopwatch.StartNew();
                var finished = false;
                while (!finished && elapsed.ElapsedMilliseconds < timeoutMilliseconds)
                {
                    var remaining = timeoutMilliseconds - (int)Math.Min(timeoutMilliseconds, elapsed.ElapsedMilliseconds);
                    finished = process.WaitForExit(Math.Min(10 * 1000, Math.Max(1, remaining)));
                    if (!finished && elapsed.ElapsedMilliseconds < timeoutMilliseconds)
                        log.Line("  -> Still working... elapsed " + Math.Max(1, (int)elapsed.Elapsed.TotalSeconds) + " seconds.", ConsoleColor.DarkGray);
                }
                if (!finished)
                {
                    try { process.Kill(); } catch { }
                    try { process.WaitForExit(5000); } catch { }
                    var timedOut = new CommandResult { ExitCode = -1, Output = Clean(output.ToString()), TimedOut = true };
                    log.Line("  [TIMEOUT] Command did not finish within " + Math.Max(1, timeoutMilliseconds / 1000) + " seconds.", ConsoleColor.Yellow);
                    if (!allowFailure) throw new TimeoutException(Path.GetFileName(file) + " did not finish in time.\n" + timedOut.Output);
                    return timedOut;
                }
                process.WaitForExit();
                var result = new CommandResult { ExitCode = process.ExitCode, Output = Clean(output.ToString()) };
                if (!allowFailure && result.ExitCode != 0 && result.ExitCode != 3010) throw new InvalidOperationException(Path.GetFileName(file) + " failed with exit code " + result.ExitCode + ".\n" + result.Output);
                return result;
            }
        }

        public CommandResult Run(string file, string arguments, bool allowFailure) { return Run(file, arguments, allowFailure, 30 * 60 * 1000); }
        public CommandResult Run(string file, string arguments) { return Run(file, arguments, false, 30 * 60 * 1000); }

        private static Encoding OutputEncodingFor(string file, string arguments)
        {
            var name = Path.GetFileName(file);
            if (String.Equals(name, "dism.exe", StringComparison.OrdinalIgnoreCase))
                return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
            if (String.Equals(name, "wsl.exe", StringComparison.OrdinalIgnoreCase) && !arguments.TrimStart().StartsWith("-d ", StringComparison.OrdinalIgnoreCase))
                return Encoding.Unicode;
            return new UTF8Encoding(false);
        }

        private void RecordLine(StringBuilder output, string line)
        {
            if (line == null) return;
            line = Clean(line);
            lock (output) output.AppendLine(line);
            log.Line(line);
        }

        public static string QuoteArgument(string value)
        {
            if (value == null) return "\"\"";
            var result = new StringBuilder("\"");
            var slashes = 0;
            foreach (var character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"')
                {
                    result.Append('\\', slashes * 2 + 1);
                    result.Append('"');
                    slashes = 0;
                    continue;
                }
                result.Append('\\', slashes);
                slashes = 0;
                result.Append(character);
            }
            result.Append('\\', slashes * 2);
            result.Append('"');
            return result.ToString();
        }

        public static string Clean(string value) { return (value ?? "").Replace("\0", "").Trim(); }
    }

    internal sealed class StateStore
    {
        private readonly string path;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
        public Dictionary<string, object> Values { get; private set; }

        public StateStore(string path)
        {
            this.path = path;
            Values = Load(path);
        }

        private Dictionary<string, object> Load(string file)
        {
            if (!File.Exists(file)) return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            var json = File.ReadAllText(file, Encoding.UTF8).TrimStart('\uFEFF');
            return serializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        public void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, serializer.Serialize(Values), new UTF8Encoding(false));
        }

        public bool Bool(string key)
        {
            object value;
            if (!Values.TryGetValue(key, out value) || value == null) return false;
            if (value is bool) return (bool)value;
            bool parsed;
            return Boolean.TryParse(Convert.ToString(value), out parsed) && parsed;
        }

        public string Text(string key)
        {
            object value;
            return Values.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }

        public List<string> Strings(string key)
        {
            object value;
            if (!Values.TryGetValue(key, out value) || value == null) return new List<string>();
            var enumerable = value as IEnumerable;
            if (value is string || enumerable == null) return new List<string> { Convert.ToString(value) };
            return enumerable.Cast<object>().Where(item => item != null).Select(Convert.ToString).ToList();
        }

        public IEnumerable<Dictionary<string, object>> Records(string key)
        {
            object value;
            if (!Values.TryGetValue(key, out value) || value == null) yield break;
            var items = value as IEnumerable;
            if (items == null || value is string) yield break;
            foreach (var item in items)
            {
                var record = item as Dictionary<string, object>;
                if (record != null) yield return record;
            }
        }
    }

    internal sealed class DependencyWorkflow
    {
        private readonly Options options;
        private readonly Logger log;
        private readonly CommandRunner commands;
        private readonly StateStore state;
        private readonly string appRoot;
        private readonly string wslRoot;
        private readonly string downloadRoot;
        private readonly string archive;

        public DependencyWorkflow(Options options, Logger log)
        {
            this.options = options;
            this.log = log;
            commands = new CommandRunner(log);
            state = new StateStore(options.StatePath);
            appRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SplatoonDeck");
            wslRoot = Path.Combine(appRoot, "wsl");
            downloadRoot = Path.Combine(appRoot, "downloads");
            archive = Path.Combine(downloadRoot, "ubuntu-wsl-rootfs.tar.gz");
        }

        public void Install()
        {
            Directory.CreateDirectory(appRoot);
            Directory.CreateDirectory(downloadRoot);
            var previousLifecycle = state.Text("lifecycle");
            var preservePrevious = File.Exists(options.StatePath) && previousLifecycle != "uninstalled";
            if (preservePrevious && state.Bool("restartRequired") && state.Text("restartReason") == "install")
            {
                log.Line("A Windows restart is still required. Restart Windows before continuing dependency setup.", ConsoleColor.Yellow);
                return;
            }

            Step("1/6", "Checking the existing Windows environment");
            var winget = FindExecutable("winget.exe");
            if (String.IsNullOrEmpty(winget)) throw new InvalidOperationException("winget was not found. Update App Installer from Microsoft Store and try again.");
            var wslFeatureBefore = IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux");
            var vmFeatureBefore = IsFeatureEnabled("VirtualMachinePlatform");
            var msiBefore = FindWslMsiProducts();
            var usbipdMsiBefore = FindUsbipdMsiProducts();
            var wslRuntimeBefore = msiBefore.Count > 0 || IsWingetPackageInstalled("Microsoft.WSL");
            var usbipdBefore = !String.IsNullOrEmpty(FindUsbipd());
            if (!preservePrevious)
            {
                state.Values.Clear();
                state.Values["installedAt"] = DateTime.UtcNow.ToString("o");
                state.Values["createdDistroByApp"] = false;
                state.Values["installedUsbipdByApp"] = false;
                state.Values["enabledWslFeatureByApp"] = false;
                state.Values["enabledVmFeatureByApp"] = false;
                state.Values["boundBluetoothByApp"] = new object[0];
                state.Values["wslEnvironmentExistedBefore"] = wslFeatureBefore || wslRuntimeBefore || ListDistros().Count > 0;
                state.Values["wslMsiProductsBefore"] = msiBefore.ToArray();
                state.Values["usbipdMsiProductsBefore"] = usbipdMsiBefore.ToArray();
                state.Values["installedWslMsiProductsByApp"] = new object[0];
                state.Values["installedUsbipdMsiProductsByApp"] = new object[0];
                state.Values["installedWslRuntimeByApp"] = false;
                state.Values["wslRuntimePrepared"] = false;
            }
            state.Values["schema"] = 4;
            state.Values["distro"] = ProgramDistro;
            state.Values["lifecycle"] = "installing";
            state.Values["restartRequired"] = false;
            state.Values["restartReason"] = null;
            state.Values["phase"] = "prerequisites";
            state.Save();

            Step("2/6", "Preparing the current Microsoft WSL runtime");
            var restartRequired = false;
            if (!state.Bool("wslRuntimePrepared"))
            {
                state.Values["phase"] = "wsl-runtime";
                state.Save();
                if (wslRuntimeBefore)
                {
                    Detail("Microsoft WSL is already installed. Checking for an available update without reinstalling the package.");
                    var upgrade = commands.Run(winget, "upgrade --id Microsoft.WSL --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity", true, 10 * 60 * 1000);
                    if (upgrade.ExitCode == 0) restartRequired = true;
                    else Detail("No WSL upgrade was applied. The installed runtime will be verified after the prerequisite stage.");
                }
                else
                {
                    Detail("Installing the current Microsoft WSL package silently. WSL will not be started during this stage.");
                    state.Values["installedWslRuntimeByApp"] = true;
                    state.Save();
                    commands.Run(winget, "install --id Microsoft.WSL --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity", false, 10 * 60 * 1000);
                    restartRequired = true;
                }
                state.Values["wslRuntimePrepared"] = true;
                var before = state.Strings("wslMsiProductsBefore");
                state.Values["installedWslMsiProductsByApp"] = FindWslMsiProducts().Where(code => !before.Contains(code, StringComparer.OrdinalIgnoreCase)).ToArray();
                state.Save();
            }
            else Detail("The WSL runtime preparation stage is already complete.");

            Step("3/6", "Preparing usbipd-win");
            if (!usbipdBefore && String.IsNullOrEmpty(FindUsbipd()))
            {
                Detail("Downloading and installing usbipd-win with winget.");
                state.Values["installedUsbipdByApp"] = true;
                state.Values["phase"] = "usbipd";
                state.Save();
                commands.Run(winget, "install --id dorssel.usbipd-win --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity", false, 10 * 60 * 1000);
                var before = state.Strings("usbipdMsiProductsBefore");
                state.Values["installedUsbipdMsiProductsByApp"] = FindUsbipdMsiProducts().Where(code => !before.Contains(code, StringComparer.OrdinalIgnoreCase)).ToArray();
                state.Save();
            }
            else Detail("usbipd-win is already available.");

            Step("4/6", "Enabling required Windows features");
            if (!wslFeatureBefore)
            {
                state.Values["enabledWslFeatureByApp"] = true;
                state.Values["phase"] = "windows-features";
                state.Save();
                EnableFeature("Microsoft-Windows-Subsystem-Linux");
                restartRequired = true;
            }
            else Detail("Windows Subsystem for Linux already existed and will be preserved.");
            if (!vmFeatureBefore)
            {
                state.Values["enabledVmFeatureByApp"] = true;
                state.Values["phase"] = "windows-features";
                state.Save();
                EnableFeature("VirtualMachinePlatform");
                restartRequired = true;
            }
            else Detail("Virtual Machine Platform already existed and will be preserved.");
            state.Values["restartRequired"] = restartRequired;
            state.Values["restartReason"] = restartRequired ? "install" : null;
            state.Values["phase"] = restartRequired ? "restart-pending" : "wsl-verification";
            state.Save();

            if (restartRequired)
            {
                log.Line("The Windows prerequisites are ready. Restart Windows, then click Continue After Restart in SplatoonDeck.", ConsoleColor.Yellow);
                return;
            }

            Step("5/6", "Verifying WSL and importing the dedicated Linux environment");
            var version = commands.Run("wsl.exe", "--version", true, 30 * 1000);
            if (version.ExitCode != 0 || version.TimedOut)
                throw new InvalidOperationException("The prepared WSL runtime is not ready. Restart Windows and try again.\n" + version.Output);
            var distros = ListDistros();
            if (!distros.Contains(ProgramDistro, StringComparer.OrdinalIgnoreCase))
            {
                var architecture = String.Equals(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"), "ARM64", StringComparison.OrdinalIgnoreCase) ? "arm64" : "amd64";
                var url = "https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-" + architecture + "-wsl.rootfs.tar.gz";
                DownloadWithResume(url, archive);
                Directory.CreateDirectory(wslRoot);
                Detail("Importing the isolated SplatoonDeck Linux environment.");
                commands.Run("wsl.exe", "--import " + Q(ProgramDistro) + " " + Q(wslRoot) + " " + Q(archive) + " --version 2", false, 10 * 60 * 1000);
                state.Values["createdDistroByApp"] = true;
                state.Values["phase"] = "linux-packages";
                state.Save();
            }
            else Detail("The SplatoonDeck Linux environment is already present.");

            Step("6/6", "Installing BlueZ, Python and NXBT");
            if (String.IsNullOrWhiteSpace(options.LinuxSetupPath) || !File.Exists(options.LinuxSetupPath)) throw new FileNotFoundException("Linux setup script was not found.", options.LinuxSetupPath);
            var linuxPathResult = commands.Run("wsl.exe", "-d " + Q(ProgramDistro) + " -u root -- wslpath -a " + Q(options.LinuxSetupPath.Replace("\\", "\\\\")));
            var linuxPath = linuxPathResult.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).LastOrDefault();
            if (String.IsNullOrWhiteSpace(linuxPath)) throw new InvalidOperationException("Could not resolve the Linux dependency setup path.");
            Detail("Linux package output will appear below.");
            commands.Run("wsl.exe", "-d " + Q(ProgramDistro) + " -u root -- bash " + Q(linuxPath));
            commands.Run("wsl.exe", "--terminate " + Q(ProgramDistro), true);
            state.Values["restartRequired"] = false;
            state.Values["restartReason"] = null;
            state.Values["lifecycle"] = "installed";
            state.Values["phase"] = "complete";
            state.Values["completed"] = true;
            state.Values["completedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        public void Uninstall()
        {
            if (!File.Exists(options.StatePath))
            {
                DeleteFile(options.SessionPath);
                log.Line("No SplatoonDeck install record was found. Nothing was removed.");
                return;
            }
            var completedInstall = state.Bool("completed") && state.Text("lifecycle") == "installed";
            state.Values["schema"] = 4;
            state.Values["lifecycle"] = "uninstalling";
            state.Values["phase"] = "cleanup";
            state.Values["restartRequired"] = false;
            state.Values["restartReason"] = null;
            state.Save();

            Step("1/5", "Returning and unsharing Bluetooth devices owned by SplatoonDeck");
            CleanupBluetooth();

            Step("2/5", "Removing the dedicated Linux environment");
            var distros = ListDistros();
            if (state.Bool("createdDistroByApp") && distros.Contains(ProgramDistro, StringComparer.OrdinalIgnoreCase))
            {
                if (completedInstall)
                {
                    Detail("Stopping and unregistering " + ProgramDistro + ".");
                    commands.Run("wsl.exe", "--terminate " + Q(ProgramDistro), true, 20 * 1000);
                    var unregister = commands.Run("wsl.exe", "--unregister " + Q(ProgramDistro), true, 30 * 1000);
                    if (unregister.ExitCode != 0 || unregister.TimedOut)
                    {
                        Detail("WSL could not unregister the environment. Removing only SplatoonDeck's registration record.");
                        RemoveDistroRegistration(ProgramDistro);
                    }
                }
                else
                {
                    Detail("Setup was not completed. Removing only SplatoonDeck's registration record without starting the outdated WSL runtime.");
                    RemoveDistroRegistration(ProgramDistro);
                }
                if (ListDistros().Contains(ProgramDistro, StringComparer.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The dedicated SplatoonDeck Linux environment could not be removed.");
            }
            else Detail("The dedicated Linux environment is already absent.");
            state.Values["createdDistroByApp"] = false;
            if (Directory.Exists(appRoot))
            {
                var expected = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SplatoonDeck"));
                var actual = Path.GetFullPath(appRoot);
                if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Refusing to remove an unexpected application data path.");
                Directory.Delete(actual, true);
                Detail("Removed downloaded setup files and the isolated Linux disk.");
            }

            Step("3/5", "Removing usbipd-win when installed by this app");
            if (state.Bool("installedUsbipdByApp"))
            {
                Detail("Uninstalling the copy of usbipd-win added by SplatoonDeck.");
                var winget = FindExecutable("winget.exe");
                if (!String.IsNullOrEmpty(winget)) commands.Run(winget, "uninstall --id dorssel.usbipd-win --exact --silent --disable-interactivity", true, 10 * 60 * 1000);
                foreach (var productCode in state.Strings("installedUsbipdMsiProductsByApp"))
                {
                    if (!IsProductCode(productCode)) continue;
                    var result = commands.Run("msiexec.exe", "/x " + Q(productCode) + " /qn /norestart", true);
                    if (result.ExitCode != 0 && result.ExitCode != 1605 && result.ExitCode != 1614 && result.ExitCode != 3010) throw new InvalidOperationException("usbipd-win uninstall failed with exit code " + result.ExitCode);
                }
            }
            else Detail("usbipd-win existed before SplatoonDeck or is already absent; preserving it.");
            state.Values["installedUsbipdByApp"] = false;
            state.Values["installedUsbipdMsiProductsByApp"] = new object[0];

            var remaining = ListDistros();
            Step("4/5", "Removing the WSL runtime added by SplatoonDeck");
            var ownsWslRuntime = state.Bool("installedWslRuntimeByApp");
            var runtimeRestart = false;
            if (remaining.Count == 0 && ownsWslRuntime)
            {
                Detail("Removing the WSL runtime added by SplatoonDeck.");
                if (IsWingetPackageInstalled("Microsoft.WSL"))
                {
                    Detail("Removing the WSL application package added by SplatoonDeck.");
                    commands.Run("winget.exe", "uninstall --id Microsoft.WSL --exact --silent --disable-interactivity", true, 10 * 60 * 1000);
                }
                foreach (var productCode in state.Strings("installedWslMsiProductsByApp"))
                {
                    if (!IsProductCode(productCode)) continue;
                    Detail("Removing WSL runtime package " + productCode + ".");
                    var result = commands.Run("msiexec.exe", "/x " + Q(productCode) + " /qn /norestart", true);
                    if (result.ExitCode != 0 && result.ExitCode != 1605 && result.ExitCode != 1614 && result.ExitCode != 3010) throw new InvalidOperationException("WSL runtime uninstall failed with exit code " + result.ExitCode);
                    runtimeRestart |= result.ExitCode == 3010;
                }
            }
            else if (remaining.Count > 0) Detail("Other WSL distributions are installed, so the shared WSL runtime is preserved.");
            else Detail("The WSL runtime existed before SplatoonDeck or is already absent; preserving it.");
            state.Values["installedWslRuntimeByApp"] = false;
            state.Values["wslRuntimePrepared"] = false;
            state.Values["installedWslMsiProductsByApp"] = new object[0];

            Step("5/5", "Checking shared Windows features");
            var restart = runtimeRestart;
            if (remaining.Count == 0 && state.Bool("enabledWslFeatureByApp")) restart |= DisableFeature("Microsoft-Windows-Subsystem-Linux");
            else if (state.Bool("enabledWslFeatureByApp")) Detail("Other WSL distributions were found, so the shared WSL feature was retained.");
            if (remaining.Count == 0 && state.Bool("enabledVmFeatureByApp")) restart |= DisableFeature("VirtualMachinePlatform");
            else if (state.Bool("enabledVmFeatureByApp")) Detail("Other WSL distributions were found, so Virtual Machine Platform was retained.");
            state.Values["enabledWslFeatureByApp"] = false;
            state.Values["enabledVmFeatureByApp"] = false;
            state.Values["completed"] = false;
            state.Values["restartRequired"] = restart;
            state.Values["restartReason"] = restart ? "uninstall" : null;
            state.Values["lifecycle"] = "uninstalled";
            state.Values["phase"] = restart ? "cleanup-restart-pending" : "cleanup-complete";
            state.Values["uninstalledAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
            DeleteFile(options.SessionPath);
        }

        public void RunUsbipd(string executable, string[] arguments)
        {
            if (String.IsNullOrWhiteSpace(executable)) throw new FileNotFoundException("usbipd.exe was not found.");
            var resolved = File.Exists(executable) ? executable : FindExecutable(Path.GetFileName(executable));
            if (String.IsNullOrWhiteSpace(resolved)) throw new FileNotFoundException("usbipd.exe was not found.", executable);
            var allowed = new[] { "bind", "unbind", "attach", "detach", "--busid" };
            foreach (var argument in arguments)
            {
                if (allowed.Contains(argument, StringComparer.OrdinalIgnoreCase)) continue;
                if (System.Text.RegularExpressions.Regex.IsMatch(argument, @"^\d+-\d+(?:\.\d+)*$")) continue;
                throw new ArgumentException("Invalid usbipd argument: " + argument);
            }
            commands.Run(resolved, String.Join(" ", arguments.Select(Q)));
        }

        private string ProgramDistro { get { return DistroName.Value; } }

        private static class DistroName { public const string Value = "SplatoonDeck"; }

        private void Step(string number, string message) { log.Line("[" + number + "] " + message, ConsoleColor.Cyan); }
        private void Detail(string message) { log.Line("  -> " + message, ConsoleColor.DarkGray); }
        private static string Q(string value) { return CommandRunner.QuoteArgument(value); }

        private bool IsFeatureEnabled(string name)
        {
            using (var searcher = new ManagementObjectSearcher("SELECT InstallState FROM Win32_OptionalFeature WHERE Name='" + name.Replace("'", "''") + "'"))
            using (var results = searcher.Get())
            {
                foreach (ManagementObject item in results) return Convert.ToInt32(item["InstallState"]) == 1;
            }
            return false;
        }

        private void EnableFeature(string name)
        {
            var dism = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "dism.exe");
            var arguments = "/Online /Enable-Feature /FeatureName:" + name + " /All /NoRestart";
            Detail("Trying the local Windows component store first: " + name + ".");
            var local = commands.Run(dism, arguments + " /LimitAccess", true, 5 * 60 * 1000);
            if (local.ExitCode == 0 || local.ExitCode == 3010) return;
            Detail("The local payload is unavailable. Windows Update will download the required component; the percentage may pause while Windows retries.");
            commands.Run(dism, arguments, false, 30 * 60 * 1000);
        }

        private bool DisableFeature(string name)
        {
            Detail("Disabling " + name + " because SplatoonDeck enabled it and no other WSL distributions remain.");
            var result = commands.Run(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "dism.exe"), "/Online /Disable-Feature /FeatureName:" + name + " /NoRestart", true);
            if (result.ExitCode != 0 && result.ExitCode != 3010) throw new InvalidOperationException("DISM failed with exit code " + result.ExitCode);
            return result.ExitCode == 3010;
        }

        private List<string> ListDistros()
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using (var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Lxss"))
            {
                if (root == null) return result.ToList();
                foreach (var keyName in root.GetSubKeyNames())
                {
                    using (var distro = root.OpenSubKey(keyName))
                    {
                        var name = distro == null ? "" : Convert.ToString(distro.GetValue("DistributionName"));
                        if (!String.IsNullOrWhiteSpace(name)) result.Add(name.Trim());
                    }
                }
            }
            return result.ToList();
        }

        private static void RemoveDistroRegistration(string distributionName)
        {
            using (var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Lxss", true))
            {
                if (root == null) return;
                string matchedKey = null;
                foreach (var keyName in root.GetSubKeyNames())
                {
                    using (var distro = root.OpenSubKey(keyName))
                    {
                        var name = distro == null ? "" : Convert.ToString(distro.GetValue("DistributionName"));
                        if (String.Equals(name, distributionName, StringComparison.OrdinalIgnoreCase)) { matchedKey = keyName; break; }
                    }
                }
                if (!String.IsNullOrEmpty(matchedKey)) root.DeleteSubKeyTree(matchedKey, false);
            }
        }

        private string FindUsbipd()
        {
            var installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "usbipd-win", "usbipd.exe");
            return File.Exists(installed) ? installed : FindExecutable("usbipd.exe");
        }

        private static string FindExecutable(string name)
        {
            var paths = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';');
            foreach (var candidate in paths.Select(folder => Path.Combine(folder.Trim(), name))) if (File.Exists(candidate)) return candidate;
            return "";
        }

        private bool IsWingetPackageInstalled(string id)
        {
            if (String.IsNullOrEmpty(FindExecutable("winget.exe"))) return false;
            var result = commands.Run("winget.exe", "list --id " + id + " --exact --accept-source-agreements --disable-interactivity", true);
            return result.ExitCode == 0 && result.Output.IndexOf(id, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private List<string> FindWslMsiProducts()
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ScanUninstallKey(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", result, IsWslProduct);
            ScanUninstallKey(Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", result, IsWslProduct);
            return result.ToList();
        }

        private List<string> FindUsbipdMsiProducts()
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ScanUninstallKey(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", result, IsUsbipdProduct);
            ScanUninstallKey(Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", result, IsUsbipdProduct);
            return result.ToList();
        }

        private static bool IsWslProduct(string displayName)
        {
            return displayName == "Windows Subsystem for Linux" || displayName == "Windows Subsystem for Linux Update";
        }

        private static bool IsUsbipdProduct(string displayName)
        {
            return !String.IsNullOrEmpty(displayName) && displayName.StartsWith("usbipd-win", StringComparison.OrdinalIgnoreCase);
        }

        private static void ScanUninstallKey(RegistryKey root, string path, HashSet<string> result, Func<string, bool> matches)
        {
            using (var key = root.OpenSubKey(path))
            {
                if (key == null) return;
                foreach (var name in key.GetSubKeyNames())
                {
                    using (var child = key.OpenSubKey(name))
                    {
                        var displayName = child == null ? "" : Convert.ToString(child.GetValue("DisplayName"));
                        if (matches(displayName)) result.Add(name);
                    }
                }
            }
        }

        private static bool IsProductCode(string value)
        {
            Guid parsed;
            return value != null && value.StartsWith("{") && value.EndsWith("}") && Guid.TryParse(value.Trim('{', '}'), out parsed);
        }

        private void DownloadWithResume(string url, string destination)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var partial = destination + ".partial";
            var remoteLength = TryGetRemoteLength(url);
            var expectedHash = TryGetExpectedSha256(url);
            if (File.Exists(destination))
            {
                var existingFinal = new FileInfo(destination).Length;
                var lengthMatches = remoteLength <= 0 || existingFinal == remoteLength;
                var hashMatches = String.IsNullOrEmpty(expectedHash) || String.Equals(ComputeSha256(destination), expectedHash, StringComparison.OrdinalIgnoreCase);
                if (lengthMatches && hashMatches)
                {
                    Detail("Using the verified Ubuntu root filesystem already on disk.");
                    return;
                }
                if (!hashMatches) File.Delete(destination);
                else if (!File.Exists(partial)) File.Move(destination, partial);
                else File.Delete(destination);
            }

            Exception lastError = null;
            for (var attempt = 1; attempt <= 4; attempt++)
            {
                try
                {
                    var existing = File.Exists(partial) ? new FileInfo(partial).Length : 0;
                    if (remoteLength > 0 && existing > remoteLength) { File.Delete(partial); existing = 0; }
                    if (remoteLength > 0 && existing == remoteLength)
                    {
                        var partialValid = String.IsNullOrEmpty(expectedHash) || String.Equals(ComputeSha256(partial), expectedHash, StringComparison.OrdinalIgnoreCase);
                        if (partialValid)
                        {
                            if (File.Exists(destination)) File.Delete(destination);
                            File.Move(partial, destination);
                            Detail("Recovered a complete Ubuntu download: " + FormatBytes(existing) + ".");
                            return;
                        }
                        File.Delete(partial);
                        existing = 0;
                    }
                    Detail((existing > 0 ? "Resuming" : "Starting") + " Ubuntu download (attempt " + attempt + "/4, " + FormatBytes(existing) + " received).");
                    var request = (HttpWebRequest)WebRequest.Create(url);
                    request.UserAgent = "SplatoonDeck/0.3.0";
                    request.AllowAutoRedirect = true;
                    request.Timeout = 60 * 1000;
                    request.ReadWriteTimeout = 60 * 1000;
                    if (existing > 0) request.AddRange(existing);
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        var append = existing > 0 && response.StatusCode == HttpStatusCode.PartialContent;
                        if (!append) existing = 0;
                        var total = remoteLength > 0 ? remoteLength : existing + response.ContentLength;
                        using (var input = response.GetResponseStream())
                        using (var output = new FileStream(partial, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read, 1024 * 128, FileOptions.SequentialScan))
                        {
                            var buffer = new byte[1024 * 128];
                            var received = existing;
                            var lastPercent = -5;
                            var lastReport = Stopwatch.StartNew();
                            int count;
                            while (input != null && (count = input.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                output.Write(buffer, 0, count);
                                received += count;
                                var percent = total > 0 ? (int)(received * 100 / total) : -1;
                                if ((percent >= 0 && percent >= lastPercent + 5) || lastReport.ElapsedMilliseconds >= 15 * 1000)
                                {
                                    if (percent >= 0) lastPercent = percent;
                                    Detail("Ubuntu download: " + (percent >= 0 ? percent + "%" : FormatBytes(received)) + " (" + FormatBytes(received) + ").");
                                    lastReport.Restart();
                                }
                            }
                            output.Flush(true);
                        }
                    }
                    var completedLength = new FileInfo(partial).Length;
                    if (remoteLength > 0 && completedLength != remoteLength) throw new IOException("The download ended early at " + FormatBytes(completedLength) + " of " + FormatBytes(remoteLength) + ".");
                    if (!String.IsNullOrEmpty(expectedHash))
                    {
                        Detail("Verifying the Ubuntu download checksum.");
                        if (!String.Equals(ComputeSha256(partial), expectedHash, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Delete(partial);
                            throw new IOException("The Ubuntu checksum did not match. The invalid partial file was discarded.");
                        }
                    }
                    if (File.Exists(destination)) File.Delete(destination);
                    File.Move(partial, destination);
                    Detail("Ubuntu download completed: " + FormatBytes(completedLength) + ".");
                    return;
                }
                catch (Exception error)
                {
                    lastError = error;
                    log.Line("  -> Download attempt " + attempt + " failed: " + error.Message, ConsoleColor.Yellow);
                    if (attempt < 4) { Detail("Retrying with the partial file preserved."); Thread.Sleep(attempt * 2000); }
                }
            }
            throw new InvalidOperationException("The Ubuntu environment could not be downloaded after 4 attempts. The partial file was preserved for the next run.", lastError);
        }

        private long TryGetRemoteLength(string url)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "HEAD";
                request.UserAgent = "SplatoonDeck/0.3.0";
                request.AllowAutoRedirect = true;
                request.Timeout = 30 * 1000;
                using (var response = request.GetResponse()) return response.ContentLength;
            }
            catch { return -1; }
        }

        private string TryGetExpectedSha256(string url)
        {
            try
            {
                var slash = url.LastIndexOf('/');
                var fileName = slash >= 0 ? url.Substring(slash + 1) : url;
                var checksumUrl = slash >= 0 ? url.Substring(0, slash + 1) + "SHA256SUMS" : "";
                if (String.IsNullOrEmpty(checksumUrl)) return "";
                var request = (HttpWebRequest)WebRequest.Create(checksumUrl);
                request.UserAgent = "SplatoonDeck/0.3.0";
                request.AllowAutoRedirect = true;
                request.Timeout = 30 * 1000;
                request.ReadWriteTimeout = 30 * 1000;
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        var parts = line.Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2 && parts[1].TrimStart('*') == fileName && parts[0].Length == 64) return parts[0].ToLowerInvariant();
                    }
                }
            }
            catch (Exception error) { log.Line("  -> Checksum metadata was unavailable: " + error.Message, ConsoleColor.Yellow); }
            return "";
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.SequentialScan))
            using (var hash = SHA256.Create())
                return String.Concat(hash.ComputeHash(stream).Select(value => value.ToString("x2", CultureInfo.InvariantCulture)));
        }

        private static string FormatBytes(long value)
        {
            if (value >= 1024L * 1024L * 1024L) return (value / (1024d * 1024d * 1024d)).ToString("0.00", CultureInfo.InvariantCulture) + " GiB";
            if (value >= 1024L * 1024L) return (value / (1024d * 1024d)).ToString("0.0", CultureInfo.InvariantCulture) + " MiB";
            if (value >= 1024L) return (value / 1024d).ToString("0.0", CultureInfo.InvariantCulture) + " KiB";
            return value.ToString(CultureInfo.InvariantCulture) + " B";
        }

        private void CleanupBluetooth()
        {
            var usbipd = FindUsbipd();
            var records = state.Records("boundBluetoothByApp").ToList();
            if (String.IsNullOrEmpty(usbipd)) { Detail("usbipd-win is absent; Bluetooth sharing cleanup is not needed."); return; }
            if (records.Count == 0) { Detail("No Bluetooth sharing records were created by this app."); return; }
            foreach (var record in records)
            {
                var busId = RecordText(record, "busId");
                var instanceId = RecordText(record, "instanceId");
                var device = FindUsbDevice(usbipd, busId, instanceId);
                if (device == null) continue;
                var currentBusId = RecordText(device, "BusId");
                if (!String.IsNullOrEmpty(RecordText(device, "ClientIPAddress")))
                {
                    Detail("Returning Bluetooth device " + currentBusId + " to Windows.");
                    commands.Run(usbipd, "detach --busid " + Q(currentBusId));
                    Thread.Sleep(750);
                    device = FindUsbDevice(usbipd, currentBusId, instanceId);
                }
                if (device != null && !String.IsNullOrEmpty(RecordText(device, "PersistedGuid")))
                {
                    Detail("Removing the USB/IP sharing record for " + currentBusId + ".");
                    commands.Run(usbipd, "unbind --busid " + Q(currentBusId));
                }
            }
            state.Values["boundBluetoothByApp"] = new object[0];
            state.Save();
        }

        private Dictionary<string, object> FindUsbDevice(string usbipd, string busId, string instanceId)
        {
            var result = commands.Run(usbipd, "state", true);
            if (result.ExitCode != 0) return null;
            try
            {
                var serializer = new JavaScriptSerializer();
                var root = serializer.Deserialize<Dictionary<string, object>>(result.Output);
                object devicesValue;
                if (root == null || !root.TryGetValue("Devices", out devicesValue)) return null;
                var devices = devicesValue as IEnumerable;
                if (devices == null) return null;
                foreach (var value in devices)
                {
                    var device = value as Dictionary<string, object>;
                    if (device == null) continue;
                    if (!String.IsNullOrEmpty(instanceId) && String.Equals(RecordText(device, "InstanceId"), instanceId, StringComparison.OrdinalIgnoreCase)) return device;
                    if (String.Equals(RecordText(device, "BusId"), busId, StringComparison.OrdinalIgnoreCase)) return device;
                }
            }
            catch { }
            return null;
        }

        private static string RecordText(Dictionary<string, object> record, string key)
        {
            object value;
            return record != null && record.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }

        private static void DeleteFile(string path)
        {
            if (!String.IsNullOrWhiteSpace(path) && File.Exists(path)) File.Delete(path);
        }
    }
}
