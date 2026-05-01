'''
2002-2025: Use is subject to Interactive Brokers TWS API Non-Commercial License ("License") terms. 
This License is NOT for anybody who is developing software applications that they wish to: (a) sell to third 
party users for a fee, or (b) give to third party users to generate an indirect financial benefit (e.g., 
commissions). If You wish to make a software application for the purposes described in the preceding 
sentence then please contact Interactive Brokers
'''

from ibapi.sync_wrapper import TWSSyncWrapper
from ibapi.contract import Contract
from ibapi.order import Order
from time import sleep

# Create the wrapper
tws = TWSSyncWrapper(timeout=10) # 10 seconds timeout
'''
This file is constructed to provide a sample of our new (10.40) TWS API 
Sync Wrapper implementation. This sync wrapper allows users to utilize
the Trader Workstation API in a synchronized structure rather than our 
standard asynchronous implementation.

Please see ibapi/sync_wrapper for more information.
'''
try:
    # Connect to TWS
    if not tws.connect_and_start("127.0.0.1", 7496, 0):
        print("Failed to connect to TWS")
        exit(1)

    print("Connected to TWS")
    
    # Get server time
    try:
        time_value = tws.get_current_time()
        print(f"Server time: {time_value}")
    except Exception as e:
        print(f"Error getting server time: {e}")

    # Define a contract (e.g., AAPL stock)
    contract = Contract()
    contract.symbol = "AAPL"
    contract.secType = "STK"
    contract.currency = "USD"
    contract.exchange = "SMART"

    # Get contract details
    try:
        details = tws.get_contract_details(contract)
        print(f"Contract details: {details[0].longName if details else 'No details'}")
    except Exception as e:
        print(f"Error getting contract details: {e}")

    # Get market data snapshot
    try:
        market_data = tws.get_market_data_snapshot(contract)
        print(f"Market data: {market_data}")
    except Exception as e:
        print(f"Error getting market data: {e}")

    # Get historical data
    try:
        bars = tws.get_historical_data(
        contract=contract,
        end_date_time="", # Empty for current time
        duration_str="1 D",
        bar_size_setting="1 hour",
        what_to_show="TRADES",
        use_rth=True
        )
        print(f"Historical data: {len(bars)} bars")
        for bar in bars[:3]: # Print first 3 bars
            print(f" {bar.date}: O={bar.open}, H={bar.high}, L={bar.low}, C={bar.close}, V={bar.volume}")
    except Exception as e:
        print(f"Error getting historical data: {e}")

    # Place a limit order (example only - won't execute)
    try:
        order = Order()
        order.action = "BUY"
        order.orderType = "LMT"
        order.totalQuantity = 1
        order.lmtPrice = 100 # Set a low price so it won't execute
        order.whatIf = True

        order_status = tws.place_order_sync(contract, order)
        print(f"Order placed: {order_status}")

        # Cancel the order
        cancel_status = tws.cancel_order_sync(order.orderId)
        print(f"Order cancelled: {cancel_status}")
    except Exception as e:
        print(f"Error with order operations: {e}")

    # Get positions
    try:
        positions = tws.get_positions()
        print(f"Positions: {positions}")
    except Exception as e:
        print(f"Error getting positions: {e}")

finally:
    # Disconnect
    print("Disconnecting...")
    tws.disconnect_and_stop()
    print("Disconnected")
