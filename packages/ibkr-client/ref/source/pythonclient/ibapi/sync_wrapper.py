'''
2002-2025: Use is subject to Interactive Brokers TWS API Non-Commercial License ("License") terms. 
This License is NOT for anybody who is developing software applications that they wish to: (a) sell to third 
party users for a fee, or (b) give to third party users to generate an indirect financial benefit (e.g., 
commissions). If You wish to make a software application for the purposes described in the preceding 
sentence then please contact Interactive Brokers
'''
# Synchronous Wrapper for TWS Python API

"""
Synchronous wrapper for Interactive Brokers TWS Python API.
This wrapper simplifies the asynchronous nature of the original API by allowing
synchronous calls that wait for responses before returning.
"""

import threading
import time
from decimal import Decimal
from ibapi.account_summary_tags import AccountSummaryTags
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract, ContractDetails
from ibapi.order import Order
from ibapi.order_state import OrderState
from ibapi.execution import Execution, ExecutionFilter
from ibapi.order_cancel import OrderCancel
from ibapi.common import TickerId, OrderId, BarData
from ibapi.ticktype import TickTypeEnum

class ResponseTimeout(Exception):
	"""Exception raised when a response is not received within the timeout period."""
	pass

class TWSSyncWrapper(EWrapper, EClient):
	"""
	Synchronous wrapper for the TWS API that combines EWrapper and EClient
	and provides synchronous methods to interact with TWS.
	"""

	def __init__(self, timeout=30):
		"""
		Initialize the wrapper with a default timeout for synchronous operations.

		Args:
		timeout: Default timeout in seconds for synchronous operations.
		"""
		EWrapper.__init__(self)
		EClient.__init__(self, wrapper=self)

		# Default timeout for synchronous operations
		self.timeout = timeout

		# Synchronization primitives
		self.response_events = {}
		self.response_data = {}

		# For storing responses
		self.contract_details = {}
		self.order_status = {}
		self.open_orders = {}
		self.executions = {}
		self.portfolio = []
		self.positions = {}
		self.account_summary = {}
		self.market_data = {}
		self.historical_data = {}
		self.current_time_value = None
		self.next_valid_id_value = None
		self.completion_events = {}
		self.errors = {}

	def connect_and_start(self, host, port, client_id):
		"""
		Connect to TWS and start the message processing thread.

		Args:
		host: TWS host, usually '127.0.0.1'
		port: TWS port, usually 7496 for TWS or 4001 for IB Gateway
		client_id: A unique client ID

		Returns:
		True if connection is successful, False otherwise
		"""
		self.connect(host, port, client_id)

		# Wait for connection to be established
		timeout = time.time() + 5 # 5 seconds timeout
		while not self.isConnected() and time.time() < timeout:
			time.sleep(0.1)

		if not self.isConnected():
			return False

		# Create a thread for message processing
		self.api_thread = threading.Thread(target=self.run)
		self.api_thread.daemon = True
		self.api_thread.start()

		# Wait for connection to be fully established (i.e. next_valid_id is received)
		timeout = time.time() + 5 # 5 seconds timeout
		while self.next_valid_id_value is None and time.time() < timeout:
			time.sleep(0.1)

		if self.next_valid_id_value is None:
			return False

		return self.isConnected()

	def _wait_for_response(self, req_id, event_name, timeout=None):
		"""
		Wait for a response from TWS for a specific request.

		Args:
			req_id: The request ID to wait for
			event_name: The event name to wait for
			timeout: Timeout in seconds (uses default if None)

		Returns:
			The response data

		Raises:
			ResponseTimeout: If no response is received within the timeout period
		"""
		if timeout is None:
			timeout = self.timeout

		event_key = f"{event_name}_{req_id}"

		# Create event if it doesn't exist
		if event_key not in self.response_events:
			self.response_events[event_key] = threading.Event()

		# Wait for the event to be set
		if not self.response_events[event_key].wait(timeout):
			# Clean up
			if event_key in self.response_events:
				del self.response_events[event_key]
			if event_key in self.response_data:
				del self.response_data[event_key]
			raise ResponseTimeout(f"No response received for {event_name} request {req_id} within {timeout} seconds")

		# Get the response data
		response = self.response_data.get(event_key)

		# Clean up
		if event_key in self.response_events:
			del self.response_events[event_key]
		if event_key in self.response_data:
			del self.response_data[event_key]

		return response

	def _set_event(self, req_id, event_name, data=None):
		"""
		Set an event to indicate that a response has been received.

		Args:
		req_id: The request ID
		event_name: The event name
		data: The response data
		"""
		event_key = f"{event_name}_{req_id}"
		self.response_data[event_key] = data

		if event_key in self.response_events:
			self.response_events[event_key].set()

	# EWrapper method overrides
	def nextValidId(self, orderId: int):
		"""Called by TWS with the next valid order ID."""
		self.next_valid_id_value = orderId
		self._set_event(0, "next_valid_id", orderId)
		super().nextValidId(orderId)

	def error(self, reqId: TickerId, errorTime: int, errorCode: int, errorString: str, advancedOrderRejectJson=""):
		"""Called when TWS returns an error message."""
		error_info = {
			"reqId": reqId,
			"errorTime": errorTime,
			"errorCode": errorCode,
			"errorString": errorString,
			"advancedOrderRejectJson": advancedOrderRejectJson
		}

		if reqId not in self.errors:
			self.errors[reqId] = []
		self.errors[reqId].append(error_info)

		# Set event for any waiting synchronous calls
		self._set_event(reqId, "error", error_info)

		super().error(reqId, errorTime, errorCode, errorString, advancedOrderRejectJson)

	def currentTime(self, time_value: int):
		"""Called with the current system time on the server side."""
		self.current_time_value = time_value
		self._set_event(0, "current_time", time_value)
		super().currentTime(time_value)

	def contractDetails(self, reqId: int, contractDetails: ContractDetails):
		"""Called with contract details."""
		if reqId not in self.contract_details:
			self.contract_details[reqId] = []
		self.contract_details[reqId].append(contractDetails)
		super().contractDetails(reqId, contractDetails)

	def contractDetailsEnd(self, reqId: int):
		"""Called when all contract details have been received."""
		self._set_event(reqId, "contract_details", self.contract_details.get(reqId, []))
		super().contractDetailsEnd(reqId)

	def orderStatus(self, orderId: OrderId, status: str, filled: Decimal, remaining: Decimal,avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float, clientId: int, whyHeld: str, mktCapPrice: float):
		"""Called when the status of an order changes."""
		order_status_data = {
			"orderId": orderId,
			"status": status,
			"filled": filled,
			"remaining": remaining,
			"avgFillPrice": avgFillPrice,
			"permId": permId,
			"parentId": parentId,
			"lastFillPrice": lastFillPrice,
			"clientId": clientId,
			"whyHeld": whyHeld,
			"mktCapPrice": mktCapPrice
		}

		self.order_status[orderId] = order_status_data
		self._set_event(orderId, "order_status", order_status_data)
		super().orderStatus(orderId, status, filled, remaining, avgFillPrice, permId, parentId,lastFillPrice, clientId, whyHeld, mktCapPrice)

	def openOrder(self, orderId: OrderId, contract: Contract, order: Order, orderState: OrderState):
		"""Called when an open order is returned."""
		open_order_data = {
			"orderId": orderId,
			"contract": contract,
			"order": order,
			"orderState": orderState
		}

		self.open_orders[orderId] = open_order_data
		super().openOrder(orderId, contract, order, orderState)

	def openOrderEnd(self):
		"""Called at the end of a request for open orders."""
		self._set_event(0, "open_orders", self.open_orders)
		super().openOrderEnd()

	def execDetails(self, reqId: int, contract: Contract, execution: Execution):
		"""Called when execution details are received."""
		if reqId not in self.executions:
			self.executions[reqId] = []

		self.executions[reqId].append({
			"contract": contract,
			"execution": execution
		})

		super().execDetails(reqId, contract, execution)

	def execDetailsEnd(self, reqId: int):
		"""Called when all execution details have been received."""
		self._set_event(reqId, "executions", self.executions.get(reqId, []))
		super().execDetailsEnd(reqId)

	def updatePortfolio(self, contract: Contract, position: Decimal, marketPrice: float, marketValue: float, averageCost: float, unrealizedPNL: float, realizedPNL: float, accountName: str):
		"""Called when portfolio data is updated."""
		portfolio_item = {
			"contract": contract,
			"position": position,
			"marketPrice": marketPrice,
			"marketValue": marketValue,
			"averageCost": averageCost,
			"unrealizedPNL": unrealizedPNL,
			"realizedPNL": realizedPNL,
			"accountName": accountName
		}

		self.portfolio.append(portfolio_item)
		super().updatePortfolio(contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, accountName)

	def accountDownloadEnd(self, accountName: str):
		"""Called when account download has finished."""
		self._set_event(0, "portfolio", self.portfolio)
		super().accountDownloadEnd(accountName)

	def position(self, account: str, contract: Contract, position: Decimal, avgCost: float):
		"""Called when position data is returned."""
		if account not in self.positions:
			self.positions[account] = []

		self.positions[account].append({
			"contract": contract,
			"position": position,
			"avgCost": avgCost
		})

		super().position(account, contract, position, avgCost)

	def positionEnd(self):
		"""Called when all position data has been received."""
		self._set_event(0, "positions", self.positions)
		super().positionEnd()

	def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str):
		"""Called when account summary data is returned."""
		if reqId not in self.account_summary:
			self.account_summary[reqId] = {}

		if account not in self.account_summary[reqId]:
			self.account_summary[reqId][account] = {}

		self.account_summary[reqId][account][tag] = {
			"value": value,
			"currency": currency
		}

		super().accountSummary(reqId, account, tag, value, currency)

	def accountSummaryEnd(self, reqId: int):
		"""Called when all account summary data has been received."""
		self._set_event(reqId, "account_summary", self.account_summary.get(reqId, {}))
		super().accountSummaryEnd(reqId)

	def tickPrice(self, reqId: TickerId, tickType: int, price: float, attrib):
		"""Called when price tick data is returned."""
		if reqId not in self.market_data:
			self.market_data[reqId] = {}

		self.market_data[reqId][TickTypeEnum.toStr(tickType)] = price

		# Don't set the event here, wait for snapshot end or a timeout
		super().tickPrice(reqId, tickType, price, attrib)

	def tickSize(self, reqId: TickerId, tickType: int, size: Decimal):
		"""Called when size tick data is returned."""
		if reqId not in self.market_data:
			self.market_data[reqId] = {}

		self.market_data[reqId][TickTypeEnum.toStr(tickType)] = size

		# Don't set the event here, wait for snapshot end or a timeout
		super().tickSize(reqId, tickType, size)

	def tickString(self, reqId, tickType, value):
		"""Called when string tick data is returned."""
		if reqId not in self.market_data:
			self.market_data[reqId] = {}
		self.market_data[reqId][TickTypeEnum.toStr(tickType)] = value

	def tickGeneric(self, reqId, tickType, value):
		"""Called when generic tick data is returned."""
		if reqId not in self.market_data:
			self.market_data[reqId] = {}
		self.market_data[reqId][TickTypeEnum.toStr(tickType)] = value
	
	def tickNews(self, reqId, timeStamp, providerCode, articleId, headline, extraData):
		if reqId not in self.market_data:
			self.market_data[reqId] = {}
		if "News" not in self.market_data[reqId].keys():
			self.market_data[reqId]["News"] = []
		self.market_data[reqId]["News"].append({"timeStamp": timeStamp, "providerCode":providerCode, "articleId":articleId, "headline": headline, "extraData": extraData})
	
	def tickSnapshotEnd(self, reqId: int):
		"""Called when all market data for a snapshot has been received."""
		self._set_event(reqId, "market_data", self.market_data.get(reqId, {}))
		super().tickSnapshotEnd(reqId)

	def historicalData(self, reqId: int, bar: BarData):
		"""Called when historical data is returned."""
		if reqId not in self.historical_data:
			self.historical_data[reqId] = []

		self.historical_data[reqId].append(bar)
		super().historicalData(reqId, bar)

	def historicalDataEnd(self, reqId: int, start: str, end: str):
		"""Called when all historical data has been received."""
		self._set_event(reqId, "historical_data", self.historical_data.get(reqId, []))
		super().historicalDataEnd(reqId, start, end)

	# Synchronous methods
	def get_next_valid_id(self, timeout=None):
		"""
		Get the next valid order ID from TWS.

		Args:
		timeout: Timeout in seconds (uses default if None)

		Returns:
		The next valid order ID

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		self.reqIds(-1)
		return self._wait_for_response(0, "next_valid_id", timeout)

	def get_current_time(self, timeout=1):
		"""
		Get the current system time on the server side.

		Args:
		timeout: Timeout in seconds (uses default if None)

		Returns:
		The current time as an integer (epoch time)

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		self.reqCurrentTime()
		return self._wait_for_response(0, "current_time", timeout)

	def get_contract_details(self, contract, timeout=5):
		"""
		Get contract details for a specific contract.

		Args:
		contract: Contract object
		timeout: Timeout in seconds (uses default if None)

		Returns:
		A list of ContractDetails objects

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		req_id = self.get_next_valid_id()
		self.reqContractDetails(req_id, contract)
		return self._wait_for_response(req_id, "contract_details", timeout)

	def place_order_sync(self, contract, order, timeout=None):
		"""
		Place an order and wait for the initial order status.

		Args:
		contract: Contract object
		order: Order object
		timeout: Timeout in seconds (uses default if None)

		Returns:
		The order status

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		if timeout is None:
			timeout = 5 if order.orderType in ["LMT", "MKT"] else 2

		order_id = self.get_next_valid_id()
		order.orderId = order_id

		# Clear any previous order status for this order ID
		if order_id in self.order_status:
			del self.order_status[order_id]

		self.placeOrder(order_id, contract, order)
		return self._wait_for_response(order_id, "order_status", timeout)

	def cancel_order_sync(self, order_id, orderCancel=None, timeout=3):
		"""
		Cancel an order and wait for the cancellation status.

		Args:
		order_id: The order ID to cancel
		orderCancel: Optional OrderCancel object for additional cancel parameters
		timeout: Timeout in seconds (uses default if None)

		Returns:
		The order status after cancellation

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		if orderCancel is None:
			orderCancel = OrderCancel()

		self.cancelOrder(order_id, orderCancel)
		return self._wait_for_response(order_id, "order_status", timeout)

	def get_open_orders(self, timeout=3):
		"""
		Get all open orders.

		Args:
		timeout: Timeout in seconds (uses default if None)

		Returns:
		A dictionary of open orders

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		# Clear existing open orders
		self.open_orders = {}

		self.reqOpenOrders()
		return self._wait_for_response(0, "open_orders", timeout)

	def get_executions(self, exec_filter=None, timeout=10):
		"""
		Get executions matching the filter.

		Args:
		exec_filter: Optional ExecutionFilter object
		timeout: Timeout in seconds (uses default if None)

		Returns:
		A list of executions

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		if exec_filter is None:
			exec_filter = ExecutionFilter()

		req_id = self.get_next_valid_id()

		# Clear existing executions for this request ID
		if req_id in self.executions:
			del self.executions[req_id]

		self.reqExecutions(req_id, exec_filter)
		return self._wait_for_response(req_id, "executions", timeout)

	def get_portfolio(self, account_code="", timeout=None):
		"""
		Get portfolio information.

		Args:
		account_code: Account code (empty for all accounts)
		timeout: Timeout in seconds (uses default if None)

		Returns:
		A list of portfolio items

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		# Clear existing portfolio
		self.portfolio = []

		self.reqAccountUpdates(True, account_code)
		portfolio = self._wait_for_response(0, "portfolio", timeout)

		# Stop the updates
		self.reqAccountUpdates(False, account_code)

		return portfolio

	def get_positions(self, timeout=10):
		"""
		Get current positions.

		Args:
		timeout: Timeout in seconds (uses default if None)

		Returns:
		A dictionary of positions by account

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		# Clear existing positions
		self.positions = {}

		self.reqPositions()
		positions = self._wait_for_response(0, "positions", timeout)

		# Cancel position updates
		self.cancelPositions()

		return positions

	def get_account_summary(self, tags, group="All", timeout=5):
		"""
		Get account summary information.

		Args:
		tags: Comma-separated string of tags to request
		group: Account group (default "All")
		timeout: Timeout in seconds (uses default if None)

		Returns:
		Account summary information

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		req_id = self.get_next_valid_id()

		# Clear existing account summary for this request
		if req_id in self.account_summary:
			del self.account_summary[req_id]

		self.reqAccountSummary(req_id, group, tags)
		summary = self._wait_for_response(req_id, "account_summary", timeout)

		# Cancel the subscription
		self.cancelAccountSummary(req_id)

		return summary

	def get_market_data_snapshot(self, contract, generic_tick_list="", snapshot=True, timeout=None):
		"""
		Get a snapshot of market data.

		Args:
		contract: Contract object
		generic_tick_list: String of generic tick types
		snapshot: Whether to request a snapshot
		timeout: Timeout in seconds (uses default if None)

		Returns:
		Market data

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		if timeout is None:
			timeout = 11 if snapshot == True else 5
		req_id = self.get_next_valid_id()

		# Clear existing market data for this request
		if req_id in self.market_data:
			del self.market_data[req_id]

		self.reqMktData(req_id, contract, generic_tick_list, snapshot, False, [])

		# For snapshots, we'll get a tickSnapshotEnd event
		if snapshot:
			data = self._wait_for_response(req_id, "market_data", timeout)
		else:
		# For streaming data, we need to wait a bit and then return what we have
			time.sleep(1 if timeout is None or timeout > 1 else timeout / 2)
			data = self.market_data.get(req_id, {})

		# Cancel if not a snapshot (snapshots auto-cancel)
		if not snapshot:
			self.cancelMktData(req_id)

		return data

	def get_historical_data(self, contract, end_date_time, duration_str, bar_size_setting,
		what_to_show, use_rth=True, format_date=1, timeout=30):
		"""
		Get historical data for a contract.

		Args:
		contract: Contract object
		end_date_time: End date and time (format: yyyyMMdd HH:mm:ss)
		duration_str: Duration string (e.g., "1 D", "1 W")
		bar_size_setting: Bar size (e.g., "1 min", "1 day")
		what_to_show: Type of data to show
		use_rth: Whether to use regular trading hours only
		format_date: Date format (1 or 2)
		timeout: Timeout in seconds (uses default if None)

		Returns:
		Historical bar data

		Raises:
		ResponseTimeout: If no response is received within the timeout period
		"""
		req_id = self.get_next_valid_id()

		# Clear existing historical data for this request
		if req_id in self.historical_data:
			del self.historical_data[req_id]

		self.reqHistoricalData(req_id, contract, end_date_time, duration_str, bar_size_setting,
		what_to_show, use_rth, format_date, False, [])

		return self._wait_for_response(req_id, "historical_data", timeout)

	def disconnect_and_stop(self):
		"""Disconnect from TWS and stop the message processing thread."""
		self.disconnect()

		# Wait for the thread to finish if it's running
		if hasattr(self, 'api_thread') and self.api_thread.is_alive():
		    self.api_thread.join(timeout=1)
