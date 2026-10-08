/** Windows Job Object supervisor: crash/parent exit closes the whole owned tree.
 * CREATE_SUSPENDED closes the assign-before-module-execution race. Not a sandbox. */
export const WINDOWS_NEWS_JOB = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NewsJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public ushort show, reservedSize; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref EXTENDED_LIMIT info,uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,string cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static int Run(string commandLine,uint parentPid,string jobName) {
    IntPtr job=CreateJobObject(IntPtr.Zero,jobName), parent=OpenProcess(0x100000,false,parentPid);
    PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
    try {
      if(job==IntPtr.Zero || parent==IntPtr.Zero) throw new Exception("Owner unavailable");
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) throw new Exception("Job setup failed");
      STARTUPINFO si=new STARTUPINFO(); si.cb=(uint)Marshal.SizeOf(si); si.flags=0x100;
      si.input=GetStdHandle(-10); si.output=GetStdHandle(-11); si.error=GetStdHandle(-12);
      if(!CreateProcess(null,commandLine,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref si,out pi)) throw new Exception("Worker creation failed");
      if(!AssignProcessToJobObject(job,pi.process)) throw new Exception("Worker assignment failed");
      if(ResumeThread(pi.thread)==0xffffffff) throw new Exception("Worker resume failed");
      uint result=WaitForMultipleObjects(2,new IntPtr[]{parent,pi.process},false,0xffffffff);
      if(result==0) return 2;
      if(result!=1) throw new Exception("Worker wait failed");
      uint code; GetExitCodeProcess(pi.process,out code); return (int)code;
    } finally {
      if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,2); CloseHandle(pi.process); }
      if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
      if(job!=IntPtr.Zero) CloseHandle(job); if(parent!=IntPtr.Zero) CloseHandle(parent);
    }
  }
}
'@
$launch = $env:OPENALICE_NEWS_LAUNCH | ConvertFrom-Json
Remove-Item Env:OPENALICE_NEWS_LAUNCH
exit [NewsJob]::Run($launch.commandLine, [uint32]$launch.parentPid, $launch.jobName)
`

export function windowsCommandLine(args: string[]): string {
  return args.map(arg => '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"').join(' ')
}

export const WINDOWS_NEWS_STOP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class NewsStop {
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out ACCOUNTING info,uint size,IntPtr length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static void Stop(string name) {
    IntPtr job=OpenJobObject(0x0c,false,name);
    if(job==IntPtr.Zero) { if(Marshal.GetLastWin32Error()==2) return; throw new Exception("Job ownership unavailable"); }
    try {
      if(!TerminateJobObject(job,2)) throw new Exception("Job termination failed");
      for(int i=0;i<100;i++) {
        ACCOUNTING info; if(!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)) throw new Exception("Job query failed");
        if(info.active==0) return; Thread.Sleep(20);
      }
      throw new Exception("Owned worker processes still active");
    } finally {CloseHandle(job);}
  }
}
'@
[NewsStop]::Stop($env:OPENALICE_NEWS_JOB_NAME)
`
