=============================================================================================
Google Protocol Buffers support in TWS API
=============================================================================================

Protocol Buffers files are generated with certain proto compiler version. These version numbers are listed below.
It is customer responsibility to generate proto files if installed proto compiler version doesn't match with version of provided proto files.
More about Protocol Buffers versions support: https://protobuf.dev/support/version-support/
To support protobuf the following new software is required:


---------------------------------------------------------------------------------------------
 Java
---------------------------------------------------------------------------------------------
Protobuf Java version 4.29.5. Jar required: protobuf-java-4.29.5.jar - this jar is located in source\javaclient\jars
Latest version can be downloaded from "https://mvnrepository.com/artifact/com.google.protobuf/protobuf-java" to include to Java API project.
To generate Java proto file, goto "source" directory and run:
    protoc --proto_path=./proto --java_out=./javaclient proto/*.proto


---------------------------------------------------------------------------------------------
C++
---------------------------------------------------------------------------------------------
Protobuf C++ version 5.29.5 (Windows)
Protobuf C++ version 3.12.4 (Linux)

Windows: to build and run C++ application under Windows the following software is required: Microsoft vcpkg, Protobuf C++ library
To install the above run the following commands:
    goto c:\
    git clone https://github.com/Microsoft/vcpkg.git
    cd vcpkg
    bootstrap-vcpkg.bat
    vcpkg integrate install
    vcpkg install protobuf
    vcpkg list

"Protobuf C++ library" for MS Visual Studio can be downloaded from: https://vcpkg.io/en/package/protobuf.html (This site is owned and maintained by Microsoft Corp)
Vcpkg details are here: https://devblogs.microsoft.com/cppblog/vcpkg-is-now-included-with-visual-studio/

To generate C++ proto file for Windows, goto "source" directory and run:
    protoc --proto_path=./proto --cpp_out=./cppclient/client/protobuf proto/*.proto

Linux: to build and run C++ application under Linux the following software is required: Protobuf for Linux library
To install the above run the following commands:
    apt-get install protobuf-compiler

"Protobuf for Linux" library installation details are here: https://protobuf.dev/installation/)

To generate C++ proto file for Linux, goto "source" directory and run:
    protoc --proto_path=./proto --experimental_allow_proto3_optional --cpp_out=./cppclient/client/protobufUnix proto/*.proto


---------------------------------------------------------------------------------------------
C#
---------------------------------------------------------------------------------------------
Protobuf C#(.NET) version 3.29.5

The following software is required: Google.Protobuf package for .NET
To install the above do the following:
    in Visual Studio run NuGet PM: Tools -> NuGet Package Manager -> Package Manager Console
    in console run: Install-Package Google.Protobuf

"Google.Protobuf package for .NET" can be installed from https://nuget.org/packages/google.protobuf/ (This site is owned and maintained by Microsoft Corp)

To generate C# proto file, goto "source" directory and run:
    protoc --proto_path=./proto --csharp_out=./csharpclient/client/protobuf proto/*.proto


---------------------------------------------------------------------------------------------
Python
---------------------------------------------------------------------------------------------
Protobuf Python version 5.29.5

To run Python application locally the following is required: Protobuf for Python library
To install the above run the following commands:
    pip install protobuf

To generate Python proto file, goto "source" directory and run:
    protoc --proto_path=./proto --python_out=./pythonclient/ibapi/protobuf proto/*.proto


