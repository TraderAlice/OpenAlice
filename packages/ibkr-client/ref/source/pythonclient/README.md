**Installation Guide for TWS API Library**

This guide provides step-by-step instructions for setting up the TWS API library, including creating virtual environments using both Anaconda and standard Python, building distributions, and testing the installation.

*Please see Understanding Code Organization and Functionality section at the bottom for  an explanation of the key terms, conventions, and code organization used.*

Step 1: Clone the TWS API repository and set up a virtual environment:

- Open a terminal or Anaconda prompt on your Windows laptop.
- Change to the directory where you want to store the TWS API repository.
- Clone the TWS API repository from GitHub using git:

```bash
git clone https://github.com/your_username/tws-api.git
```

Replace `your_username` with your actual GitHub username.

Step 2: Create a new Python virtual environment (using Anaconda):

- First, ensure you are within the '\tws-api\source\pythonclient' folder inside the "tws-api" repository:

```Anaconda Prompt
cd tws-api/source/pythonclient
```

- Create a new Python virtual environment using Anaconda:

```Anaconda Prompt
conda create -n tws_env python=3.9
```

Replace `tws_env` with your desired environment name. Here, we are using Python 3.9 as an example, but you can choose another Python version if needed.

- *Alternative: Create a new Python virtual environment without Anaconda:*

```bash
python3 -m venv tws_env
```

Replace `tws_env` with your desired environment name.

Step 3: Activate the virtual environment:

- Activate the newly created virtual environment:

```Anaconda Prompt
conda activate tws_env
```

- *Alternative: Activate the virtual environment without Anaconda:*

```bash
source tws_env/bin/activate
```

Step 4: Install the TWS API library:

- Build the source distribution:

```Anaconda Prompt
python setup.py sdist
```

- Build the wheel distribution:

```Anaconda Prompt
python setup.py bdist_wheel
```

- Retrieve the wheel distribution file name from the dist folder under the tws-api/source/pythonclient folder:

  For instance, if the wheel distribution file name is `ibapi-9.76.1-py3-none-any.whl`

- Install the wheel distribution using `pip` with the `--user` flag using the following command:

```Anaconda Prompt
python3 -m pip install --user --upgrade dist/ibapi-9.76.1-py3-none-any.whl
```

Step 5: Create a new Jupyter kernel with the virtual environment:

- Install Jupyter if you haven't already (skip this step if you have Jupyter installed):

```Anaconda Prompt
conda install jupyter
```

- Install the ipykernel package to enable creating a Jupyter kernel for the virtual environment:

```Anaconda Prompt
conda install ipykernel
```

- Create a new Jupyter kernel for the virtual environment:

```Anaconda Prompt
python -m ipykernel install --user --name tws_env --display-name "TWS Environment"
```

Replace `tws_env` with the same environment name used in Step 2.

Step 6: Open Jupyter Notebook and select the new kernel:

- Launch Jupyter Notebook:

```Anaconda Prompt
jupyter notebook
```

Step 7: Create a new Jupyter Notebook and test the TWS API library installed:

- In the Jupyter Notebook interface, create a new notebook by clicking on "New" and then selecting "TWS Environment" from the list of available kernels.

- Run the following code in the first cell of the notebook to test the TWS API library:
```
import ibapi

print("TWS API version:", ibapi.__version__)
```
Congratulations, now you have a new Jupyter Notebook with the TWS API library installed in the virtual environment, and you can start coding and testing your trading strategies using the TWS API.



**Understanding Code Organization and Functionality**

This section provides insights into how the TWS API library is structured, how messages are received and sent, and how to interact with the Wrapper class for handling incoming messages. Understanding these concepts will help you effectively utilize the TWS API for your trading automation needs.

A couple of things/definitions/conventions:
* a *low level message* is some data prefixed with its size
* a *high level message* is a list of fields separated by the NULL character; the fields are all strings; the message ID is the first field, the come others whose number and semantics depend on the message itself
* a *request* is a message from client to TWS/IBGW (IB Gateway)
* an *answer* is a message from TWS/IBGW to client


How the code is organized:
* *comm* module: has tools that know how to handle (eg: encode/decode) low and high level messages
* *Connection*: glorified socket
* *Reader*: thread that uses Connection to read packets, transform to low level messages and put in a Queue
* *Decoder*: knows how to take a low level message and decode into high level message
* *Client*:
  + knows to send requests
  + has the message loop which takes low level messages from Queue and uses Decoder to transform into high level message with which it then calls the corresponding Wrapper method
* *Wrapper*: class that needs to be subclassed by the user so that it can get the incoming messages


The info/data flow is:

* receiving:
  + *Connection.recv_msg()* (which is essentially a socket) receives the packets
    - uses *Connection._recv_all_msgs()* which tries to combine smaller packets into bigger ones based on some trivial heuristic
  + *Reader.run()* uses *Connection.recv_msg()* to get a packet and then uses *comm.read_msg()* to try to make it a low level message. If that can't be done yet (size prefix says so) then it waits for more packets
  + if a full low level message is received then it is placed in the Queue (remember this is a standalone thread)
  + the main thread runs the *Client.run()* loop which:
    - gets a low level message from Queue
    - uses *comm.py* to translate into high level message (fields)
    - uses *Decoder.interpret()* to act based on that message
  + *Decoder.interpret()* will translate the fields into function parameters of the correct type and call with the correct/corresponding method of *Wrapper* class

* sending:
  + *Client* class has methods that implement the _requests_. The user will call those request methods with the needed parameters and *Client* will send them to the TWS/IBGW.


Implementation notes:

* the *Decoder* has two ways of handling a message (essentially decoding the fields)
    + some message very neatly map to a function call; meaning that the number of fields and order are the same as the method parameters. For example: Wrapper.tickSize(). In this case a simple mapping is made between the incoming msg id and the Wrapper method:

    IN.TICK_SIZE: HandleInfo(wrap=Wrapper.tickSize), 

    + other messages are more complex, depend on version number heavily or need field massaging. In this case the incoming message id is mapped to a processing function that will do all that and call the Wrapper method at the end. For example:

    IN.TICK_PRICE: HandleInfo(proc=processTickPriceMsg), 