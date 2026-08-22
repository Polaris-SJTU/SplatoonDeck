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
                var userPhase = options.Action == "install-user";
                if (!userPhase && !options.Elevated) return RelaunchElevated(options);
                if (!userPhase && !IsAdministrator()) throw new UnauthorizedAccessException("Administrator permission was not granted.");
                OpenProgressConsole();
                Console.OutputEncoding = new UTF8Encoding(false);
                var actionTitle = options.Action == "uninstall" ? "Uninstalling dependencies" : options.Action == "usbipd" ? "Updating Bluetooth access" : userPhase ? "Preparing the Linux environment" : "Installing dependencies";
                Console.Title = "SplatoonDeck - " + actionTitle;
                using (var log = new Logger(options.LogPath))
                {
                    DependencyWorkflow workflow = null;
                    try
                    {
                        log.Line("SplatoonDeck - " + actionTitle, ConsoleColor.Cyan);
                        log.Line("Keep this window open while the operation is running.", ConsoleColor.DarkGray);
                        log.Line("");
                        using (var operation = OperationGuard.Acquire(options.Action))
                        {
                            workflow = new DependencyWorkflow(options, log);
                            if (options.Action == "uninstall") workflow.Uninstall();
                            else if (options.Action == "usbipd") workflow.RunUsbipd(options.UsbipdPath, options.UsbipdArguments());
                            else if (userPhase) workflow.InstallUserEnvironment();
                            else workflow.Install();
                        }
                        log.Line("");
                        var completed = options.Action == "uninstall" ? "Dependency cleanup completed." : options.Action == "usbipd" ? "Bluetooth access updated." : "Dependency setup completed.";
                        if (options.Action == "install" && new StateStore(options.StatePath).Bool("restartRequired"))
                            completed = "Prerequisite stage completed. Restart Windows to continue setup.";
                        if (options.Action == "install" && new StateStore(options.StatePath).Text("phase") == "linux-user-pending")
                            completed = "System prerequisites completed. Continuing Linux setup as the signed-in Windows user.";
                        if (options.Action == "uninstall" && new StateStore(options.StatePath).Bool("restartRequired"))
                            completed = "Dependency cleanup completed. Restart Windows to finish restoring the original environment.";
                        log.Line("[DONE] " + completed, ConsoleColor.Green);
                        log.Line("Log: " + options.LogPath, ConsoleColor.DarkGray);
                        Thread.Sleep(2000);
                        return 0;
                    }
                    catch (Exception error)
                    {
                        if (workflow != null && (options.Action == "install" || options.Action == "install-user" || options.Action == "uninstall")) workflow.RecordFailure(error);
                        log.Line("");
                        log.Line("[FAILED] The operation could not be completed.", ConsoleColor.Red);
                        log.Line(error.ToString(), ConsoleColor.Red);
                        log.Line("Log: " + options.LogPath, ConsoleColor.Yellow);
                        log.Line("");
                        Console.Write("Press Enter to close this window: ");
                        Console.ReadLine();
                        if (workflow != null && (options.Action == "install" || options.Action == "install-user" || options.Action == "uninstall")) workflow.MarkFailureAcknowledged();
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
                    if (process.ExitCode != 0) return process.ExitCode;
                }
                var state = new StateStore(options.StatePath);
                if (options.Action == "install" && state.Text("phase") == "linux-user-pending" && state.Text("stageStatus") == "ready-for-user-phase")
                {
                    var userInfo = new ProcessStartInfo
                    {
                        FileName = Process.GetCurrentProcess().MainModule.FileName,
                        Arguments = String.Join(" ", options.ForAction("install-user").Select(CommandRunner.QuoteArgument)),
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
                    };
                    using (var userProcess = Process.Start(userInfo))
                    {
                        if (userProcess == null) return 1;
                        userProcess.WaitForExit();
                        return userProcess.ExitCode;
                    }
                }
                return 0;
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
                var state = new StateStore(options.StatePath);
                state.Values["selfTest"] = true;
                state.Save();
                if (!new StateStore(options.StatePath).Bool("selfTest") || File.Exists(options.StatePath + ".new")) return 1;
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
            if (args.Length == 0 || (args[0] != "install" && args[0] != "install-user" && args[0] != "uninstall" && args[0] != "usbipd" && args[0] != "self-test")) throw new ArgumentException("Expected install, install-user, uninstall, usbipd, or self-test action.");
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

        public string[] ForAction(string action) { return BaseArguments(action).ToArray(); }

        public string ToCommandLine(bool elevated)
        {
            var values = BaseArguments();
            if (elevated) values.Add("--elevated");
            return String.Join(" ", values.Select(CommandRunner.QuoteArgument));
        }

        private List<string> BaseArguments() { return BaseArguments(Action); }

        private List<string> BaseArguments(string action)
        {
            var values = new List<string> { action, "--state", StatePath, "--session", SessionPath ?? "", "--linux-setup", LinuxSetupPath ?? "", "--log", LogPath };
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
            var wslError = System.Text.RegularExpressions.Regex.Match(line, @"Wsl/[A-Za-z0-9_./-]+");
            if (wslError.Success) line = "WSL error: " + wslError.Value;
            else if (line.IndexOf('\uFFFD') >= 0) return;
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
            var temporary = path + ".new";
            File.WriteAllText(temporary, serializer.Serialize(Values), new UTF8Encoding(false));
            if (File.Exists(path))
            {
                try { File.Replace(temporary, path, null, true); }
                catch (PlatformNotSupportedException) { File.Copy(temporary, path, true); File.Delete(temporary); }
                catch (IOException) { File.Copy(temporary, path, true); File.Delete(temporary); }
            }
            else File.Move(temporary, path);
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
        private string operation;
        private int stageIndex;
        private int stageTotal;

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

        public void RecordFailure(Exception error)
        {
            state.Values["lifecycle"] = operation == "uninstall" ? "uninstall-failed" : "install-failed";
            state.Values["stageStatus"] = "failed-awaiting-confirmation";
            state.Values["awaitingUserConfirmation"] = true;
            state.Values["failedPhase"] = state.Text("phase");
            state.Values["errorCode"] = ErrorCode(error);
            state.Values["errorMessage"] = FriendlyError(error);
            state.Values["errorDetail"] = error.ToString();
            state.Values["retryable"] = true;
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        public void MarkFailureAcknowledged()
        {
            state.Values["stageStatus"] = "failed";
            state.Values["awaitingUserConfirmation"] = false;
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        private void StartOperation(string value, int total)
        {
            operation = value;
            stageIndex = 0;
            stageTotal = total;
            state.Values["operation"] = value;
            state.Values["operationId"] = Guid.NewGuid().ToString("N");
            state.Values["stageIndex"] = 0;
            state.Values["stageTotal"] = total;
            state.Values["stageStatus"] = "running";
            state.Values["awaitingUserConfirmation"] = false;
            state.Values["progressPercent"] = 0;
            state.Values["errorCode"] = null;
            state.Values["errorMessage"] = null;
            state.Values["errorDetail"] = null;
            state.Values["failedPhase"] = null;
            state.Values["retryable"] = false;
            state.Values["startedAt"] = DateTime.UtcNow.ToString("o");
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        private void Stage(int index, string phase, string title, string nextTitle)
        {
            stageIndex = index;
            state.Values["phase"] = phase;
            state.Values["stageIndex"] = index;
            state.Values["stageTotal"] = stageTotal;
            state.Values["stageTitle"] = title;
            state.Values["stageDetail"] = title;
            state.Values["nextTitle"] = nextTitle ?? "";
            state.Values["stageStatus"] = "running";
            state.Values["awaitingUserConfirmation"] = false;
            state.Values["progressPercent"] = Math.Max(0, Math.Min(99, (index - 1) * 100 / Math.Max(1, stageTotal)));
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
            log.Line("[" + index + "/" + stageTotal + "] " + title, ConsoleColor.Cyan);
        }

        private void FinishOperation(string lifecycle, string phase, bool restartRequired, string restartReason)
        {
            state.Values["lifecycle"] = lifecycle;
            state.Values["phase"] = phase;
            state.Values["stageStatus"] = restartRequired ? "restart-required" : "completed";
            state.Values["progressPercent"] = 100;
            state.Values["restartRequired"] = restartRequired;
            state.Values["restartReason"] = restartRequired ? restartReason : null;
            state.Values["completed"] = lifecycle == "installed";
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        private void PauseForRestart(string reason)
        {
            state.Values["lifecycle"] = operation == "uninstall" ? "uninstalling" : "installing";
            state.Values["phase"] = "restart-pending";
            state.Values["stageStatus"] = "restart-required";
            state.Values["progressPercent"] = Math.Max(0, Math.Min(99, stageIndex * 100 / Math.Max(1, stageTotal)));
            state.Values["restartRequired"] = true;
            state.Values["restartReason"] = reason;
            state.Values["completed"] = false;
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
        }

        private static string ErrorCode(Exception error)
        {
            if (error is UnauthorizedAccessException) return "ADMIN_REQUIRED";
            if (error is TimeoutException) return "COMMAND_TIMEOUT";
            if (error is FileNotFoundException) return "REQUIRED_FILE_MISSING";
            if (error is WebException || error is IOException) return "NETWORK_OR_FILE_ERROR";
            return "SETUP_FAILED";
        }

        private static string FriendlyError(Exception error)
        {
            if (error is TimeoutException) return "A Windows setup command took too long. Restart Windows, then retry this operation.";
            if (error is WebException) return "A required download failed. Check the network connection and retry; completed download data will be reused.";
            return error.Message;
        }

        public void Install()
        {
            Directory.CreateDirectory(appRoot);
            Directory.CreateDirectory(downloadRoot);
            var previousLifecycle = state.Text("lifecycle");
            if (previousLifecycle == "uninstalling" || previousLifecycle == "uninstall-failed")
                throw new InvalidOperationException("Dependency cleanup is incomplete. Retry Uninstall Dependencies before installing again.");
            if (state.Bool("restartRequired") && state.Text("restartReason") == "install")
            {
                state.Values["stageStatus"] = "restart-required";
                state.Values["stageDetail"] = "Restart Windows before continuing dependency setup.";
                state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
                state.Save();
                log.Line("A Windows restart is still required. Restart Windows before continuing dependency setup.", ConsoleColor.Yellow);
                return;
            }

            var existingRecord = File.Exists(options.StatePath) && !String.IsNullOrEmpty(previousLifecycle);
            var newBaseline = !existingRecord || previousLifecycle == "uninstalled";
            if (newBaseline) state.Values.Clear();
            else if (!state.Bool("baselineCaptured")) MigrateLegacyBaseline();
            state.Values["schema"] = 5;
            state.Values["distro"] = ProgramDistro;
            state.Values["lifecycle"] = "installing";
            state.Values["restartRequired"] = false;
            state.Values["restartReason"] = null;
            StartOperation("install", 7);

            Stage(1, "baseline", "Checking the existing Windows environment", "Prepare the WSL runtime");
            var winget = FindExecutable("winget.exe");
            if (String.IsNullOrEmpty(winget)) throw new InvalidOperationException("winget was not found. Update App Installer from Microsoft Store and try again.");
            if (newBaseline) CaptureBaseline();
            else Detail("Reusing the original environment snapshot so a later uninstall can still restore it.");
            ReconcileInterruptedInstall();
            if (state.Bool("dedicatedDistroExistedBefore") && !state.Bool("createdDistroByApp"))
                throw new InvalidOperationException("A Linux distribution named SplatoonDeck already existed before setup. Rename or remove that distribution, then retry; it will not be modified by this app.");

            Stage(2, "wsl-runtime", "Preparing the Microsoft WSL runtime", "Prepare USB/IP support");
            var restartRequired = false;
            if (!CurrentWslRuntimeInstalled())
            {
                Detail("Installing Microsoft WSL because no WSL runtime package existed in the original environment.");
                state.Values["wslRuntimeInstallAttempted"] = true;
                state.Save();
                var install = RunWindowsInstallerWithRetry(winget, "install --id Microsoft.WSL --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity", "Microsoft WSL", 10 * 60 * 1000);
                WaitForWindowsInstallerIdle("finishing the Microsoft WSL installation", 3 * 60 * 1000);
                if (!CurrentWslRuntimeInstalled())
                    throw new InvalidOperationException("Microsoft WSL could not be installed (exit code " + install.ExitCode + ").\n" + install.Output);
                state.Values["installedWslRuntimeByApp"] = !state.Bool("wslRuntimeInstalledBefore");
                state.Values["wslInstallMethod"] = "winget";
                restartRequired |= install.ExitCode == 3010;
            }
            else Detail(state.Bool("wslRuntimeInstalledBefore") ? "Microsoft WSL already existed and will not be upgraded or replaced." : "The WSL runtime installed by the previous attempt is ready.");
            state.Values["wslRuntimePrepared"] = true;
            state.Values["installedWslMsiProductsByApp"] = AddedProducts("wslMsiProductsBefore", FindWslMsiProducts()).ToArray();
            state.Values["restartRequired"] = restartRequired;
            state.Values["restartReason"] = restartRequired ? "install" : null;
            state.Save();

            Stage(3, "usbipd", "Preparing USB/IP support", "Enable Windows features");
            if (String.IsNullOrEmpty(FindUsbipd()))
            {
                Detail("Downloading and installing usbipd-win with winget.");
                state.Values["usbipdInstallAttempted"] = true;
                state.Save();
                var install = RunWindowsInstallerWithRetry(winget, "install --id dorssel.usbipd-win --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity", "usbipd-win", 10 * 60 * 1000);
                WaitForWindowsInstallerIdle("finishing the usbipd-win installation", 3 * 60 * 1000);
                if (String.IsNullOrEmpty(FindUsbipd()))
                    throw new InvalidOperationException("usbipd-win could not be installed (exit code " + install.ExitCode + ").\n" + install.Output);
                state.Values["installedUsbipdByApp"] = !state.Bool("usbipdInstalledBefore");
                restartRequired |= install.ExitCode == 3010;
            }
            else Detail(state.Bool("usbipdInstalledBefore") ? "usbipd-win already existed and will be preserved." : "The usbipd-win copy installed by the previous attempt is ready.");
            state.Values["installedUsbipdMsiProductsByApp"] = AddedProducts("usbipdMsiProductsBefore", FindUsbipdMsiProducts()).ToArray();
            state.Values["restartRequired"] = restartRequired;
            state.Values["restartReason"] = restartRequired ? "install" : null;
            state.Save();

            Stage(4, "windows-features", "Enabling the required Windows features", "Create the private Linux environment");
            var wslFeatureEnabled = IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux");
            var vmFeatureEnabled = IsFeatureEnabled("VirtualMachinePlatform");
            if (!wslFeatureEnabled || !vmFeatureEnabled)
            {
                state.Values["windowsFeatureEnableAttempted"] = true;
                state.Save();
                if (!wslFeatureEnabled)
                {
                    if (!state.Bool("wslFeatureEnabledBefore")) state.Values["enabledWslFeatureByApp"] = true;
                    state.Save();
                    restartRequired |= EnableFeatureWithDism("Microsoft-Windows-Subsystem-Linux");
                }
                if (!vmFeatureEnabled)
                {
                    if (!state.Bool("vmFeatureEnabledBefore")) state.Values["enabledVmFeatureByApp"] = true;
                    state.Save();
                    restartRequired |= EnableFeatureWithDism("VirtualMachinePlatform");
                }
                state.Save();
                Detail("Windows accepted the feature changes. Their final enabled state will be verified after restart.");
            }
            else Detail("The required Windows features (WSL and Virtual Machine Platform) are already enabled.");

            if (restartRequired)
            {
                state.Values["nextTitle"] = "Restart Windows, then continue creating the private Linux environment";
                PauseForRestart("install");
                log.Line("The Windows prerequisites are ready. Restart Windows, then click Continue After Restart in SplatoonDeck.", ConsoleColor.Yellow);
                return;
            }

            state.Values["lifecycle"] = "installing";
            state.Values["phase"] = "linux-user-pending";
            state.Values["stageIndex"] = 5;
            state.Values["stageTotal"] = 7;
            state.Values["stageStatus"] = "ready-for-user-phase";
            state.Values["stageTitle"] = "Create the private SplatoonDeck Linux environment";
            state.Values["stageDetail"] = "System prerequisites are ready. Continuing Linux setup as the signed-in Windows user.";
            state.Values["nextTitle"] = "Install BlueZ, Python and NXBT";
            state.Values["progressPercent"] = 57;
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
            log.Line("System prerequisites are ready. Continuing the Linux environment setup as the signed-in Windows user.", ConsoleColor.Cyan);
        }

        public void InstallUserEnvironment()
        {
            if (!File.Exists(options.StatePath)) throw new InvalidOperationException("The dependency setup record is missing. Start dependency installation again.");
            if (state.Bool("restartRequired")) throw new InvalidOperationException("Restart Windows before continuing the Linux environment setup.");
            operation = "install";
            stageTotal = 7;
            stageIndex = 4;
            state.Values["operation"] = "install";
            state.Values["lifecycle"] = "installing";
            state.Values["stageStatus"] = "running";
            state.Values["errorCode"] = null;
            state.Values["errorMessage"] = null;
            state.Values["errorDetail"] = null;
            state.Values["failedPhase"] = null;
            state.Values["retryable"] = false;
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();

            Stage(5, "linux-environment", "Creating the private SplatoonDeck Linux environment", "Install BlueZ, Python and NXBT");
            var version = commands.Run("wsl.exe", "--version", true, 30 * 1000);
            if (version.ExitCode != 0 || version.TimedOut)
                throw new InvalidOperationException("The prepared WSL runtime is not ready. Restart Windows and try again.\n" + version.Output);
            var distroPath = FindDistroBasePath(ProgramDistro);
            if (String.IsNullOrEmpty(distroPath))
            {
                var architecture = String.Equals(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"), "ARM64", StringComparison.OrdinalIgnoreCase) ? "arm64" : "amd64";
                var url = "https://cloud-images.ubuntu.com/wsl/releases/noble/current/ubuntu-noble-wsl-" + architecture + "-wsl.rootfs.tar.gz";
                DownloadWithResume(url, archive);
                Directory.CreateDirectory(wslRoot);
                Detail("Importing the isolated SplatoonDeck Linux environment.");
                state.Values["distroImportAttempted"] = true;
                state.Save();
                commands.Run("wsl.exe", "--import " + ProgramDistro + " " + Q(wslRoot) + " " + Q(archive) + " --version 2", false, 10 * 60 * 1000);
                distroPath = FindDistroBasePath(ProgramDistro);
            }
            if (!IsExpectedDistroPath(distroPath))
                throw new InvalidOperationException("The SplatoonDeck Linux environment points to an unexpected location and will not be modified: " + distroPath);
            state.Values["createdDistroByApp"] = true;
            state.Save();
            WaitForDistroReady();

            Stage(6, "linux-packages", "Installing BlueZ, Python and NXBT", "Verify the completed environment");
            if (String.IsNullOrWhiteSpace(options.LinuxSetupPath) || !File.Exists(options.LinuxSetupPath)) throw new FileNotFoundException("Linux setup script was not found.", options.LinuxSetupPath);
            var linuxPathResult = RunDistroCommandWithRetry("-u root -- wslpath -a " + Q(options.LinuxSetupPath.Replace("\\", "\\\\")), false, 60 * 1000);
            var linuxPath = linuxPathResult.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).LastOrDefault();
            if (String.IsNullOrWhiteSpace(linuxPath)) throw new InvalidOperationException("Could not resolve the Linux dependency setup path.");
            Detail("Linux package output will appear below.");
            RunDistroCommandWithRetry("-u root -- bash " + Q(linuxPath), false, 30 * 60 * 1000);

            Stage(7, "verification", "Verifying the completed environment", null);
            VerifyInstalledEnvironment();
            commands.Run("wsl.exe", "--terminate " + ProgramDistro, true);
            state.Values["completedAt"] = DateTime.UtcNow.ToString("o");
            FinishOperation("installed", "complete", false, null);
        }

        private void WaitForDistroReady()
        {
            var result = RunDistroCommandWithRetry("-u root -- sh -lc " + Q("printf SPLATOONDECK_WSL_READY"), true, 30 * 1000);
            if (result.ExitCode != 0 || result.Output.IndexOf("SPLATOONDECK_WSL_READY", StringComparison.Ordinal) < 0)
                throw new InvalidOperationException(FriendlyDistroFailure(result));
        }

        private CommandResult RunDistroCommandWithRetry(string arguments, bool allowFailure, int timeoutMilliseconds)
        {
            CommandResult result = null;
            for (var attempt = 1; attempt <= 60; attempt++)
            {
                result = commands.Run("wsl.exe", "-d " + ProgramDistro + " " + arguments, true, timeoutMilliseconds);
                if (result.ExitCode == 0) return result;
                if (!IsDistroNotReady(result)) break;
                if (attempt == 60) break;
                Detail("WSL has registered SplatoonDeck and is refreshing its first-start state. Retrying automatically (attempt " + (attempt + 1) + "/60; up to 5 minutes).");
                commands.Run("wsl.exe", "--list --verbose", true, 30 * 1000);
                Thread.Sleep(5 * 1000);
            }
            if (!allowFailure) throw new InvalidOperationException(FriendlyDistroFailure(result));
            return result;
        }

        private static bool IsDistroNotReady(CommandResult result)
        {
            return result != null && (result.Output ?? "").IndexOf("WSL_E_DISTRO_NOT_FOUND", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static string FriendlyDistroFailure(CommandResult result)
        {
            if (IsDistroNotReady(result)) return "WSL imported the private Linux environment but did not finish registering it. Restart Windows, then retry; the verified download will be reused.";
            var output = result == null ? "" : result.Output ?? "";
            var code = System.Text.RegularExpressions.Regex.Match(output, @"Wsl/[A-Za-z0-9_./-]+");
            return "The private SplatoonDeck Linux environment could not be started" + (code.Success ? " (" + code.Value + ")" : "") + ". Restart Windows, then retry.";
        }

        public void Uninstall()
        {
            if (!File.Exists(options.StatePath))
            {
                DeleteFile(options.SessionPath);
                log.Line("No SplatoonDeck install record was found. Nothing was removed.");
                return;
            }
            var completedInstall = state.Bool("completed");
            var restart = state.Bool("restartRequired") && state.Text("restartReason") == "uninstall";
            state.Values["schema"] = 5;
            state.Values["lifecycle"] = "uninstalling";
            state.Values["restartRequired"] = restart;
            state.Values["restartReason"] = restart ? "uninstall" : null;
            StartOperation("uninstall", 6);
            var issues = new List<string>();

            var bluetoothClean = CleanupStage(1, "cleanup-bluetooth", "Returning Bluetooth to Windows", "Remove the private Linux environment", issues, delegate { CleanupBluetooth(); });
            var distroClean = CleanupStage(2, "cleanup-distro", "Removing the private SplatoonDeck Linux environment", "Remove USB/IP support added by SplatoonDeck", issues, delegate
            {
                RemoveOwnedDistro(completedInstall);
                RemoveAppData();
            });
            var usbipdClean = CleanupStage(3, "cleanup-usbipd", "Removing USB/IP support added by SplatoonDeck", "Remove the WSL runtime added by SplatoonDeck", issues, delegate
            {
                if (!bluetoothClean) throw new InvalidOperationException("Bluetooth cleanup must succeed before usbipd-win can be removed.");
                restart |= RemoveOwnedUsbipd();
            });
            var runtimeClean = CleanupStage(4, "cleanup-wsl-runtime", "Removing the WSL runtime added by SplatoonDeck", "Restore shared Windows features", issues, delegate
            {
                if (!distroClean) throw new InvalidOperationException("The private Linux environment must be removed before the shared WSL runtime can be changed.");
                restart |= RemoveOwnedWslRuntime();
            });
            CleanupStage(5, "cleanup-features", "Restoring shared Windows features", "Verify that cleanup is complete", issues, delegate
            {
                if (!runtimeClean) throw new InvalidOperationException("The WSL runtime cleanup must succeed before Windows features can be restored.");
                restart |= RestoreOwnedFeatures();
            });
            CleanupStage(6, "cleanup-verification", "Verifying that cleanup is complete", null, issues, delegate
            {
                if (state.Bool("createdDistroByApp") || state.Bool("installedUsbipdByApp") || state.Bool("installedWslRuntimeByApp") || state.Bool("enabledWslFeatureByApp") || state.Bool("enabledVmFeatureByApp"))
                    throw new InvalidOperationException("Some app-owned dependencies still need cleanup. Retry Uninstall Dependencies.");
            });

            state.Values["restartRequired"] = restart;
            state.Values["restartReason"] = restart ? "uninstall" : null;
            state.Save();
            if (issues.Count > 0)
            {
                state.Values["cleanupIssues"] = issues.ToArray();
                state.Values["completed"] = false;
                state.Save();
                throw new InvalidOperationException("Cleanup finished with " + issues.Count + " unresolved stage(s):\n" + String.Join("\n", issues));
            }

            state.Values["cleanupIssues"] = new object[0];
            state.Values["uninstalledAt"] = DateTime.UtcNow.ToString("o");
            FinishOperation("uninstalled", restart ? "cleanup-restart-pending" : "cleanup-complete", restart, "uninstall");
            DeleteFile(options.SessionPath);
        }

        private void CaptureBaseline()
        {
            var wslFeature = IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux");
            var vmFeature = IsFeatureEnabled("VirtualMachinePlatform");
            var wslMsi = FindWslMsiProducts();
            var usbipdMsi = FindUsbipdMsiProducts();
            var distros = ListDistros();
            var wslRuntime = CurrentWslRuntimeInstalled();
            var usbipd = !String.IsNullOrEmpty(FindUsbipd());
            state.Values["baselineCaptured"] = true;
            state.Values["baselineCapturedAt"] = DateTime.UtcNow.ToString("o");
            state.Values["installedAt"] = DateTime.UtcNow.ToString("o");
            state.Values["wslFeatureEnabledBefore"] = wslFeature;
            state.Values["vmFeatureEnabledBefore"] = vmFeature;
            state.Values["wslRuntimeInstalledBefore"] = wslRuntime;
            state.Values["usbipdInstalledBefore"] = usbipd;
            state.Values["distrosBefore"] = distros.ToArray();
            state.Values["dedicatedDistroExistedBefore"] = distros.Contains(ProgramDistro, StringComparer.OrdinalIgnoreCase);
            state.Values["wslEnvironmentExistedBefore"] = wslFeature || wslRuntime || distros.Count > 0;
            state.Values["wslMsiProductsBefore"] = wslMsi.ToArray();
            state.Values["usbipdMsiProductsBefore"] = usbipdMsi.ToArray();
            state.Values["createdDistroByApp"] = false;
            state.Values["installedUsbipdByApp"] = false;
            state.Values["installedWslRuntimeByApp"] = false;
            state.Values["enabledWslFeatureByApp"] = false;
            state.Values["enabledVmFeatureByApp"] = false;
            state.Values["installedWslMsiProductsByApp"] = new object[0];
            state.Values["installedUsbipdMsiProductsByApp"] = new object[0];
            state.Values["boundBluetoothByApp"] = new object[0];
            state.Save();
            Detail("The original WSL, Linux distribution, USB/IP and Windows feature state has been recorded.");
        }

        private void MigrateLegacyBaseline()
        {
            var wslFeature = IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux");
            var vmFeature = IsFeatureEnabled("VirtualMachinePlatform");
            var runtime = CurrentWslRuntimeInstalled();
            var usbipd = !String.IsNullOrEmpty(FindUsbipd());
            var distros = ListDistros();
            state.Values["baselineCaptured"] = true;
            state.Values["baselineCapturedAt"] = DateTime.UtcNow.ToString("o");
            state.Values["baselineMigratedFromLegacyState"] = true;
            state.Values["wslFeatureEnabledBefore"] = wslFeature && !state.Bool("enabledWslFeatureByApp");
            state.Values["vmFeatureEnabledBefore"] = vmFeature && !state.Bool("enabledVmFeatureByApp");
            state.Values["wslRuntimeInstalledBefore"] = runtime && !state.Bool("installedWslRuntimeByApp");
            state.Values["usbipdInstalledBefore"] = usbipd && !state.Bool("installedUsbipdByApp");
            state.Values["distrosBefore"] = distros.Where(name => !state.Bool("createdDistroByApp") || !String.Equals(name, ProgramDistro, StringComparison.OrdinalIgnoreCase)).ToArray();
            state.Values["dedicatedDistroExistedBefore"] = distros.Contains(ProgramDistro, StringComparer.OrdinalIgnoreCase) && !state.Bool("createdDistroByApp");
            if (state.Bool("installedWslRuntimeByApp") && String.IsNullOrEmpty(state.Text("wslInstallMethod"))) state.Values["wslInstallMethod"] = "winget";
            if (!state.Values.ContainsKey("wslMsiProductsBefore")) state.Values["wslMsiProductsBefore"] = new object[0];
            if (!state.Values.ContainsKey("usbipdMsiProductsBefore")) state.Values["usbipdMsiProductsBefore"] = new object[0];
            state.Save();
            Detail("The previous SplatoonDeck ownership record was upgraded without changing the existing environment.");
        }

        private void ReconcileInterruptedInstall()
        {
            if (state.Bool("wslRuntimeInstallAttempted") && !state.Bool("wslRuntimeInstalledBefore") && CurrentWslRuntimeInstalled()) state.Values["installedWslRuntimeByApp"] = true;
            if (state.Bool("usbipdInstallAttempted") && !state.Bool("usbipdInstalledBefore") && !String.IsNullOrEmpty(FindUsbipd())) state.Values["installedUsbipdByApp"] = true;
            if (state.Bool("windowsFeatureEnableAttempted"))
            {
                if (!state.Bool("wslFeatureEnabledBefore") && IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux")) state.Values["enabledWslFeatureByApp"] = true;
                if (!state.Bool("vmFeatureEnabledBefore") && IsFeatureEnabled("VirtualMachinePlatform")) state.Values["enabledVmFeatureByApp"] = true;
            }
            var distroPath = FindDistroBasePath(ProgramDistro);
            if (state.Bool("distroImportAttempted") && !state.Bool("dedicatedDistroExistedBefore") && IsExpectedDistroPath(distroPath)) state.Values["createdDistroByApp"] = true;
            state.Save();
        }

        private List<string> AddedProducts(string baselineKey, List<string> current)
        {
            var baseline = state.Strings(baselineKey);
            return current.Where(code => !baseline.Contains(code, StringComparer.OrdinalIgnoreCase)).ToList();
        }

        private CommandResult RunWindowsInstallerWithRetry(string file, string arguments, string component, int commandTimeout)
        {
            CommandResult last = null;
            for (var attempt = 1; attempt <= 6; attempt++)
            {
                WaitForWindowsInstallerIdle("installing " + component, 3 * 60 * 1000);
                last = commands.Run(file, arguments, true, commandTimeout);
                if (!IsWindowsInstallerBusy(last)) return last;
                if (attempt == 6) break;
                Detail("Windows Installer is finishing another package. Waiting before retrying " + component + " (attempt " + (attempt + 1) + "/6).");
                Thread.Sleep(10 * 1000);
            }
            throw new TimeoutException("Windows Installer remained busy while preparing " + component + ". Restart Windows, then retry; completed stages will be reused.\n" + (last == null ? "" : last.Output));
        }

        private static bool IsWindowsInstallerBusy(CommandResult result)
        {
            if (result == null) return false;
            var output = result.Output ?? "";
            return result.ExitCode == 1618 ||
                output.IndexOf("exit code: 1618", StringComparison.OrdinalIgnoreCase) >= 0 ||
                output.IndexOf("0x80070652", StringComparison.OrdinalIgnoreCase) >= 0 ||
                output.IndexOf("another installation is already in progress", StringComparison.OrdinalIgnoreCase) >= 0 ||
                output.IndexOf("另一个安装程序", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void WaitForWindowsInstallerIdle(string purpose, int timeoutMilliseconds)
        {
            var elapsed = Stopwatch.StartNew();
            var announced = false;
            while (true)
            {
                Mutex installer = null;
                var acquired = false;
                try
                {
                    installer = Mutex.OpenExisting(@"Global\_MSIExecute");
                    try { acquired = installer.WaitOne(0, false); }
                    catch (AbandonedMutexException) { acquired = true; }
                    if (acquired)
                    {
                        installer.ReleaseMutex();
                        return;
                    }
                }
                catch (WaitHandleCannotBeOpenedException) { return; }
                catch (UnauthorizedAccessException) { return; }
                finally { if (installer != null) installer.Dispose(); }

                if (elapsed.ElapsedMilliseconds >= timeoutMilliseconds)
                    throw new TimeoutException("Windows Installer did not become available while " + purpose + ". Restart Windows, then retry.");
                if (!announced)
                {
                    Detail("Another Windows installation is still finishing. Waiting before " + purpose + ".");
                    announced = true;
                }
                Thread.Sleep(5 * 1000);
            }
        }

        private bool CleanupStage(int index, string phase, string title, string nextTitle, List<string> issues, Action action)
        {
            Stage(index, phase, title, nextTitle);
            try
            {
                action();
                state.Values["lastCompletedCleanupStage"] = index;
                state.Save();
                return true;
            }
            catch (Exception error)
            {
                var issue = title + ": " + error.Message;
                issues.Add(issue);
                state.Values["stageStatus"] = "warning";
                state.Values["stageDetail"] = issue;
                state.Values["cleanupIssues"] = issues.ToArray();
                state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
                state.Save();
                log.Line("  [FAILED] " + issue, ConsoleColor.Yellow);
                return false;
            }
        }

        private bool CurrentWslRuntimeInstalled()
        {
            return FindWslMsiProducts().Count > 0 ||
                RegistryContainsPackage(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Appx\AppxAllUserStore\Applications", "WindowsSubsystemForLinux") ||
                RegistryContainsPackage(Registry.CurrentUser, @"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages", "WindowsSubsystemForLinux") ||
                IsWingetPackageInstalled("Microsoft.WSL");
        }

        private static bool RegistryContainsPackage(RegistryKey root, string path, string token)
        {
            try
            {
                using (var key = root.OpenSubKey(path))
                {
                    return key != null && key.GetSubKeyNames().Any(name => name.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0);
                }
            }
            catch { return false; }
        }

        private string FindDistroBasePath(string distributionName)
        {
            using (var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Lxss"))
            {
                if (root == null) return "";
                foreach (var keyName in root.GetSubKeyNames())
                {
                    using (var distro = root.OpenSubKey(keyName))
                    {
                        var name = distro == null ? "" : Convert.ToString(distro.GetValue("DistributionName"));
                        if (String.Equals(name, distributionName, StringComparison.OrdinalIgnoreCase))
                            return Environment.ExpandEnvironmentVariables(Convert.ToString(distro.GetValue("BasePath")) ?? "");
                    }
                }
            }
            return "";
        }

        private bool IsExpectedDistroPath(string path)
        {
            if (String.IsNullOrWhiteSpace(path)) return false;
            var expected = Path.GetFullPath(wslRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var actual = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase);
        }

        private void RemoveOwnedDistro(bool completedInstall)
        {
            if (!state.Bool("createdDistroByApp"))
            {
                Detail("The private Linux environment was not created by SplatoonDeck and will be preserved.");
                return;
            }
            var distroPath = FindDistroBasePath(ProgramDistro);
            if (!String.IsNullOrEmpty(distroPath) && !IsExpectedDistroPath(distroPath))
                throw new InvalidOperationException("Refusing to remove a distribution stored outside the SplatoonDeck data directory: " + distroPath);
            if (!String.IsNullOrEmpty(distroPath) && completedInstall)
            {
                Detail("Stopping and unregistering " + ProgramDistro + ".");
                commands.Run("wsl.exe", "--terminate " + ProgramDistro, true, 20 * 1000);
                var unregister = commands.Run("wsl.exe", "--unregister " + ProgramDistro, true, 2 * 60 * 1000);
                if (unregister.ExitCode != 0 || unregister.TimedOut)
                    Detail("WSL could not unregister the environment normally; its app-owned registration will be removed directly.");
            }
            if (!String.IsNullOrEmpty(FindDistroBasePath(ProgramDistro))) RemoveDistroRegistration(ProgramDistro);
            if (!String.IsNullOrEmpty(FindDistroBasePath(ProgramDistro)))
                throw new InvalidOperationException("The private SplatoonDeck Linux environment could not be unregistered.");
            state.Values["createdDistroByApp"] = false;
            state.Save();
        }

        private void RemoveAppData()
        {
            if (!Directory.Exists(appRoot)) return;
            var expected = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SplatoonDeck"));
            var actual = Path.GetFullPath(appRoot);
            if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Refusing to remove an unexpected application data path.");
            Directory.Delete(actual, true);
            Detail("Removed downloaded setup files and the isolated Linux disk.");
        }

        private bool RemoveOwnedUsbipd()
        {
            if (!state.Bool("installedUsbipdByApp"))
            {
                Detail("usbipd-win existed before SplatoonDeck or is already absent; it will be preserved.");
                return false;
            }
            Detail("Removing only the usbipd-win copy installed by SplatoonDeck.");
            var restart = false;
            var failures = new List<string>();
            var winget = FindExecutable("winget.exe");
            if (!String.IsNullOrEmpty(winget))
            {
                var result = commands.Run(winget, "uninstall --id dorssel.usbipd-win --exact --silent --disable-interactivity", true, 10 * 60 * 1000);
                if (!AcceptedUninstallExit(result.ExitCode)) failures.Add("winget exit code " + result.ExitCode);
                restart |= result.ExitCode == 3010;
            }
            foreach (var productCode in state.Strings("installedUsbipdMsiProductsByApp"))
            {
                if (!IsProductCode(productCode)) continue;
                var result = commands.Run("msiexec.exe", "/x " + Q(productCode) + " /qn /norestart", true, 10 * 60 * 1000);
                if (!AcceptedUninstallExit(result.ExitCode)) failures.Add("MSI " + productCode + " exit code " + result.ExitCode);
                restart |= result.ExitCode == 3010;
            }
            if (!String.IsNullOrEmpty(FindUsbipd()) && !restart)
                throw new InvalidOperationException("usbipd-win is still installed. " + String.Join("; ", failures));
            state.Values["installedUsbipdByApp"] = false;
            state.Values["installedUsbipdMsiProductsByApp"] = new object[0];
            state.Save();
            return restart;
        }

        private bool RemoveOwnedWslRuntime()
        {
            var remaining = ListDistros();
            if (remaining.Count > 0)
            {
                Detail("Other Linux distributions are installed, so the shared WSL runtime is preserved.");
                state.Values["installedWslRuntimeByApp"] = false;
                state.Values["installedWslMsiProductsByApp"] = new object[0];
                state.Save();
                return false;
            }
            if (!state.Bool("installedWslRuntimeByApp"))
            {
                Detail("The WSL runtime existed before SplatoonDeck or is already absent; it will be preserved.");
                return false;
            }
            Detail("Removing only the WSL runtime installed by SplatoonDeck.");
            var restart = false;
            var failures = new List<string>();
            var winget = FindExecutable("winget.exe");
            if (!String.IsNullOrEmpty(winget) && state.Text("wslInstallMethod") == "winget")
            {
                var result = commands.Run(winget, "uninstall --id Microsoft.WSL --exact --silent --disable-interactivity", true, 10 * 60 * 1000);
                if (!AcceptedUninstallExit(result.ExitCode)) failures.Add("winget exit code " + result.ExitCode);
                restart |= result.ExitCode == 3010;
            }
            foreach (var productCode in state.Strings("installedWslMsiProductsByApp"))
            {
                if (!IsProductCode(productCode)) continue;
                var result = commands.Run("msiexec.exe", "/x " + Q(productCode) + " /qn /norestart", true, 10 * 60 * 1000);
                if (!AcceptedUninstallExit(result.ExitCode)) failures.Add("MSI " + productCode + " exit code " + result.ExitCode);
                restart |= result.ExitCode == 3010;
            }
            if (CurrentWslRuntimeInstalled() && !restart)
                throw new InvalidOperationException("The WSL runtime is still installed. " + String.Join("; ", failures));
            state.Values["installedWslRuntimeByApp"] = false;
            state.Values["installedWslMsiProductsByApp"] = new object[0];
            state.Values["wslRuntimePrepared"] = false;
            state.Save();
            return restart;
        }

        private bool RestoreOwnedFeatures()
        {
            var remaining = ListDistros();
            if (remaining.Count > 0)
            {
                Detail("Other Linux distributions are installed, so shared WSL features are preserved.");
                state.Values["enabledWslFeatureByApp"] = false;
                state.Values["enabledVmFeatureByApp"] = false;
                state.Save();
                return false;
            }
            var restart = false;
            if (state.Bool("enabledWslFeatureByApp"))
            {
                restart |= DisableFeature("Microsoft-Windows-Subsystem-Linux");
                state.Values["enabledWslFeatureByApp"] = false;
                state.Save();
            }
            else Detail("The WSL optional feature existed before SplatoonDeck or is already disabled; it will be preserved.");
            if (state.Bool("enabledVmFeatureByApp"))
            {
                restart |= DisableFeature("VirtualMachinePlatform");
                state.Values["enabledVmFeatureByApp"] = false;
                state.Save();
            }
            else Detail("Virtual Machine Platform existed before SplatoonDeck or is already disabled; it will be preserved.");
            return restart;
        }

        private void VerifyInstalledEnvironment()
        {
            if (!IsFeatureEnabled("Microsoft-Windows-Subsystem-Linux") || !IsFeatureEnabled("VirtualMachinePlatform"))
                throw new InvalidOperationException("The required Windows features are not enabled.");
            if (!CurrentWslRuntimeInstalled()) throw new InvalidOperationException("The Microsoft WSL runtime could not be verified.");
            if (!IsExpectedDistroPath(FindDistroBasePath(ProgramDistro))) throw new InvalidOperationException("The private Linux environment could not be verified.");
            if (String.IsNullOrEmpty(FindUsbipd())) throw new InvalidOperationException("usbipd-win could not be verified.");
            var command = "command -v bluetoothctl >/dev/null && test -x /opt/splatoondeck/venv/bin/python && /opt/splatoondeck/venv/bin/python -c 'import nxbt'";
            var linux = commands.Run("wsl.exe", "-d " + ProgramDistro + " -u root -- sh -lc " + Q(command), true, 60 * 1000);
            if (linux.ExitCode != 0 || linux.TimedOut) throw new InvalidOperationException("BlueZ or NXBT verification failed.\n" + linux.Output);
        }

        private static bool AcceptedUninstallExit(int code)
        {
            return code == 0 || code == 1605 || code == 1614 || code == 3010;
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
        private void Detail(string message)
        {
            state.Values["stageDetail"] = message;
            var download = System.Text.RegularExpressions.Regex.Match(message ?? "", @"Ubuntu download:\s*(\d+)%", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (download.Success)
            {
                int percent;
                if (Int32.TryParse(download.Groups[1].Value, out percent))
                    state.Values["progressPercent"] = Math.Max(0, Math.Min(99, ((stageIndex - 1) * 100 + percent) / Math.Max(1, stageTotal)));
            }
            state.Values["updatedAt"] = DateTime.UtcNow.ToString("o");
            state.Save();
            log.Line("  -> " + message, ConsoleColor.DarkGray);
        }
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

        private bool DisableFeature(string name)
        {
            Detail("Disabling " + name + " because SplatoonDeck enabled it and no other WSL distributions remain.");
            var result = commands.Run(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "dism.exe"), "/Online /Disable-Feature /FeatureName:" + name + " /NoRestart", true, 10 * 60 * 1000);
            if (result.TimedOut) throw new TimeoutException("Windows did not finish disabling " + name + ". Restart Windows, then retry cleanup.");
            if (result.ExitCode != 0 && result.ExitCode != 3010)
                throw new InvalidOperationException("Windows could not disable " + name + " (DISM exit code " + result.ExitCode + ").\n" + result.Output);
            if (IsFeatureEnabled(name))
                throw new InvalidOperationException(name + " is still enabled after Windows reported that cleanup completed. Restart Windows, then retry cleanup.");
            return result.ExitCode == 3010;
        }

        private bool EnableFeatureWithDism(string name)
        {
            Detail("Enabling " + name + " with Windows component servicing.");
            var dism = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "dism.exe");
            var result = RunWindowsInstallerWithRetry(dism, "/Online /Enable-Feature /FeatureName:" + name + " /All /NoRestart", name, 10 * 60 * 1000);
            if (result.TimedOut) throw new TimeoutException("Windows did not finish enabling " + name + ". Restart Windows, then retry.");
            if (result.ExitCode != 0 && result.ExitCode != 3010)
                throw new InvalidOperationException("Windows could not enable " + name + " (DISM exit code " + result.ExitCode + ").\n" + result.Output);
            return true;
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
            var result = commands.Run("winget.exe", "list --id " + id + " --exact --accept-source-agreements --disable-interactivity", true, 90 * 1000);
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
