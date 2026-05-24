using System.Diagnostics;
using System.Runtime.InteropServices;

namespace AniListManagerPortable;

internal sealed class TrayApp : IDisposable
{
    private const int IconId = 1;
    private const int TimerId = 101;
    private const uint WmDestroy = 0x0002;
    private const uint WmCommand = 0x0111;
    private const uint WmTimer = 0x0113;
    private const uint WmUser = 0x0400;
    private const uint WmTray = WmUser + 1;
    private const uint WmLButtonUp = 0x0202;
    private const uint WmRButtonUp = 0x0205;
    private const uint NimAdd = 0x00000000;
    private const uint NimModify = 0x00000001;
    private const uint NimDelete = 0x00000002;
    private const uint NifMessage = 0x00000001;
    private const uint NifIcon = 0x00000002;
    private const uint NifTip = 0x00000004;
    private const uint MfString = 0x00000000;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmNonotify = 0x0080;
    private const uint TpmReturNcmd = 0x0100;
    private const int IdOpen = 2001;
    private const int IdStart = 2002;
    private const int IdStop = 2003;
    private const int IdRefresh = 2004;
    private const int IdExit = 2005;

    private readonly ApiServer server;
    private readonly TokenStore tokens;
    private readonly WndProc wndProc;
    private IntPtr hwnd;
    private IntPtr currentIcon;
    private TrayState state = TrayState.Unknown;
    private string statusText = "starting";
    private bool disposed;

    public TrayApp(ApiServer server, TokenStore tokens)
    {
        this.server = server;
        this.tokens = tokens;
        wndProc = WindowProc;
    }

    public void Run()
    {
        RegisterWindow();
        _ = StartServerAsync(openAfterStart: true);
        AddOrUpdateIcon(NimAdd);
        SetTimer(hwnd, TimerId, 10_000, IntPtr.Zero);

        while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }

    private void RegisterWindow()
    {
        var className = "AniListManagerPortableTrayWindow";
        var windowClass = new WndClassEx
        {
            cbSize = (uint)Marshal.SizeOf<WndClassEx>(),
            lpfnWndProc = wndProc,
            hInstance = GetModuleHandle(null),
            lpszClassName = className
        };
        RegisterClassEx(ref windowClass);
        hwnd = CreateWindowEx(0, className, "AniList Manager Portable", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, windowClass.hInstance, IntPtr.Zero);
        if (hwnd == IntPtr.Zero)
        {
            throw new InvalidOperationException("Could not create tray message window.");
        }
    }

    private IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        switch (message)
        {
            case WmTray:
                var mouseMessage = (uint)lParam.ToInt64();
                if (mouseMessage is WmLButtonUp or WmRButtonUp)
                {
                    ShowMenu();
                }
                return IntPtr.Zero;
            case WmTimer:
                RefreshState();
                return IntPtr.Zero;
            case WmCommand:
                HandleCommand(wParam.ToInt32() & 0xffff);
                return IntPtr.Zero;
            case WmDestroy:
                ShellNotifyIcon(NimDelete, BuildNotifyData(currentIcon));
                PostQuitMessage(0);
                return IntPtr.Zero;
        }

        return DefWindowProc(window, message, wParam, lParam);
    }

    private void HandleCommand(int id)
    {
        switch (id)
        {
            case IdOpen:
                OpenApp();
                break;
            case IdStart:
                _ = StartServerAsync();
                break;
            case IdStop:
                _ = StopServerAsync();
                break;
            case IdRefresh:
                RefreshState();
                break;
            case IdExit:
                Exit();
                break;
        }
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        AppendMenu(menu, MfString, (UIntPtr)IdOpen, "Open");
        AppendMenu(menu, MfString, (UIntPtr)IdStart, "Start Server");
        AppendMenu(menu, MfString, (UIntPtr)IdStop, "Stop Server");
        AppendMenu(menu, MfString, (UIntPtr)IdRefresh, "Refresh Status");
        AppendMenu(menu, MfString, (UIntPtr)IdExit, "Exit");

        GetCursorPos(out var point);
        SetForegroundWindow(hwnd);
        var command = TrackPopupMenu(menu, TpmRightButton | TpmNonotify | TpmReturNcmd, point.X, point.Y, 0, hwnd, IntPtr.Zero);
        DestroyMenu(menu);
        if (command != 0)
        {
            HandleCommand(command);
        }
    }

    private async Task StartServerAsync(bool openAfterStart = false)
    {
        SetState(TrayState.Unknown, "starting");
        try
        {
            await server.StartAsync();
            RefreshState();
            if (openAfterStart)
            {
                OpenApp();
            }
        }
        catch
        {
            SetState(TrayState.Error, "start failed");
        }
    }

    private async Task StopServerAsync()
    {
        SetState(TrayState.Unknown, "stopping");
        await server.StopAsync();
        RefreshState();
    }

    private void RefreshState()
    {
        if (!server.IsRunning)
        {
            SetState(TrayState.Stopped, "stopped");
            return;
        }

        SetState(tokens.Resolve().Token is not null ? TrayState.Running : TrayState.Unhealthy,
            tokens.Resolve().Token is not null ? "running" : "running, token missing");
    }

    private void SetState(TrayState nextState, string nextStatusText)
    {
        state = nextState;
        statusText = nextStatusText;
        AddOrUpdateIcon(NimModify);
    }

    private void AddOrUpdateIcon(uint action)
    {
        if (hwnd == IntPtr.Zero)
        {
            return;
        }

        var nextIcon = CreateStatusIcon(StateColor(state));
        var oldIcon = currentIcon;
        currentIcon = nextIcon;
        ShellNotifyIcon(action, BuildNotifyData(currentIcon));
        if (oldIcon != IntPtr.Zero)
        {
            DestroyIcon(oldIcon);
        }
    }

    private NotifyIconData BuildNotifyData(IntPtr icon)
    {
        return new NotifyIconData
        {
            cbSize = (uint)Marshal.SizeOf<NotifyIconData>(),
            hWnd = hwnd,
            uID = IconId,
            uFlags = NifMessage | NifIcon | NifTip,
            uCallbackMessage = WmTray,
            hIcon = icon,
            szTip = $"AniList Manager: {statusText}"
        };
    }

    private static (byte R, byte G, byte B) StateColor(TrayState state) =>
        state switch
        {
            TrayState.Running => (28, 145, 84),
            TrayState.Unhealthy => (214, 156, 33),
            TrayState.Error => (190, 55, 55),
            _ => (128, 135, 145)
        };

    private static IntPtr CreateStatusIcon((byte R, byte G, byte B) color)
    {
        const int width = 32;
        const int height = 32;
        var xor = new byte[width * height * 4];
        var and = new byte[((width + 31) / 32) * 4 * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var dx = x - 15.5;
                var dy = y - 15.5;
                var inside = dx * dx + dy * dy <= 12.5 * 12.5;
                var offset = (y * width + x) * 4;
                xor[offset] = color.B;
                xor[offset + 1] = color.G;
                xor[offset + 2] = color.R;
                xor[offset + 3] = inside ? (byte)255 : (byte)0;
            }
        }
        return CreateIcon(IntPtr.Zero, width, height, 1, 32, and, xor);
    }

    private static void OpenApp()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "http://localhost:6767",
            UseShellExecute = true
        });
    }

    private void Exit()
    {
        server.StopAsync().GetAwaiter().GetResult();
        ShellNotifyIcon(NimDelete, BuildNotifyData(currentIcon));
        PostQuitMessage(0);
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        ShellNotifyIcon(NimDelete, BuildNotifyData(currentIcon));
        if (currentIcon != IntPtr.Zero)
        {
            DestroyIcon(currentIcon);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint cbSize;
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Msg
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public Point pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WndClassEx lpwcx);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out Msg lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Msg lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Msg lpMsg);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int nExitCode);

    [DllImport("user32.dll")]
    private static extern UIntPtr SetTimer(IntPtr hWnd, int nIDEvent, uint uElapse, IntPtr lpTimerFunc);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenu(IntPtr hMenu, uint uFlags, UIntPtr uIDNewItem, string lpNewItem);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

    [DllImport("user32.dll")]
    private static extern IntPtr CreateIcon(IntPtr hInstance, int nWidth, int nHeight, byte cPlanes, byte cBitsPixel, byte[] lpbANDbits, byte[] lpbXORbits);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint dwMessage, ref NotifyIconData lpData);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    private static bool ShellNotifyIcon(uint message, NotifyIconData data) => Shell_NotifyIcon(message, ref data);
}

internal enum TrayState
{
    Unknown,
    Running,
    Unhealthy,
    Stopped,
    Error
}
