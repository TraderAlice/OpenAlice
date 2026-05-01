"""
Copyright (C) 2019 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

import argparse
import datetime

from ibapi.client import EClient
from ibapi.common import *
from ibapi.contract import *
from ibapi.order import *
from ibapi.order_condition import *
from ibapi.order_state import *
from ibapi.scanner import ScannerSubscription
from ibapi.ticktype import TickType, TickTypeEnum
from ibapi.utils import *
from ibapi.wrapper import EWrapper


# import pdb; pdb.set_trace()
# import code; code.interact(local=locals())
# import code; code.interact(local=dict(globals(), **locals()))


class TestApp(EClient, EWrapper):
    def __init__(self):
        EClient.__init__(self, self)
        self.nextValidOrderId = None
        self.permId2ord = {}

    @iswrapper
    def nextValidId(self, orderId: int):
        super().nextValidId(orderId)
        logging.debug("setting nextValidOrderId: %d", orderId)
        self.nextValidOrderId = orderId

    def placeOneOrder(self):
        con = Contract()
        con.symbol = "AMD"
        con.secType = "STK"
        con.currency = "USD"
        con.exchange = "SMART"
        order = Order()
        order.action = "BUY"
        order.orderType = "LMT"
        order.tif = "GTC"
        order.totalQuantity = 3
        order.lmtPrice = 1.23
        self.placeOrder(self.nextOrderId(), con, order)

    def cancelOneOrder(self):
        pass

    def nextOrderId(self):
        id_ = self.nextValidOrderId
        self.nextValidOrderId += 1
        return id_

    @iswrapper
    def error(self, *args):
        super().error(*args)
        print(current_fn_name(), vars())

    @iswrapper
    def winError(self, *args):
        super().error(*args)
        print(current_fn_name(), vars())

    @iswrapper
    def openOrder(
        self, orderId: OrderId, contract: Contract, order: Order, orderState: OrderState
    ):
        super().openOrder(orderId, contract, order, orderState)
        print(current_fn_name(), vars())

        order.contract = contract
        self.permId2ord[order.permId] = order

    @iswrapper
    def openOrderEnd(self, *args):
        super().openOrderEnd()
        logging.debug("Received %d openOrders", len(self.permId2ord))

    @iswrapper
    def orderStatus(
        self,
        orderId: OrderId,
        status: str,
        filled: float,
        remaining: float,
        avgFillPrice: float,
        permId: int,
        parentId: int,
        lastFillPrice: float,
        clientId: int,
        whyHeld: str,
    ):
        super().orderStatus(
            orderId,
            status,
            Decimal(filled),
            Decimal(remaining),
            avgFillPrice,
            permId,
            parentId,
            lastFillPrice,
            clientId,
            whyHeld,
            0,
        )

    @iswrapper
    def tickPrice(self, tickerId: TickerId, tickType: TickType, price: float, attrib):
        super().tickPrice(tickerId, tickType, price, attrib)
        print(
            current_fn_name(),
            tickerId,
            TickTypeEnum.toStr(tickType),
            price,
            attrib,
            file=sys.stderr,
        )

    @iswrapper
    def tickSize(self, tickerId: TickerId, tickType: TickType, size: int):
        super().tickSize(tickerId, tickType, Decimal(size))
        print(
            current_fn_name(),
            tickerId,
            TickTypeEnum.toStr(tickType),
            size,
            file=sys.stderr,
        )

    @iswrapper
    def scannerParameters(self, xml: str):
        open("scanner.xml", "w").write(xml)


def main():
    cmdLineParser = argparse.ArgumentParser("api tests")
    # cmdLineParser.add_option("-c", action="store_true", dest="use_cache", default = False, help = "use the cache")
    # cmdLineParser.add_option("-f", action="store", type="string", dest="file", default="", help="the input file")
    cmdLineParser.add_argument(
        "-p",
        "--port",
        action="store",
        type=int,
        dest="port",
        default=4005,
        help="The TCP port to use",
    )
    args = cmdLineParser.parse_args()
    print("Using args", args)

    import logging

    logging.debug("Using args %s", args)
    # print(args)

    logging.debug("now is %s", datetime.datetime.now())
    logging.getLogger().setLevel(logging.ERROR)

    # enable logging when member vars are assigned
    import ibapi.utils as utils
    from ibapi.order import Order

    Order.__setattr__ = utils.setattr_log
    from ibapi.contract import Contract, DeltaNeutralContract

    Contract.__setattr__ = utils.setattr_log
    DeltaNeutralContract.__setattr__ = utils.setattr_log
    from ibapi.tag_value import TagValue

    TagValue.__setattr__ = utils.setattr_log
    TimeCondition.__setattr__ = utils.setattr_log
    ExecutionCondition.__setattr__ = utils.setattr_log
    MarginCondition.__setattr__ = utils.setattr_log
    PriceCondition.__setattr__ = utils.setattr_log
    PercentChangeCondition.__setattr__ = utils.setattr_log
    VolumeCondition.__setattr__ = utils.setattr_log

    # from inspect import signature as sig
    # import code; code.interact(local=dict(globals(), **locals()))
    # sys.exit(1)

    app = TestApp()
    app.connect("127.0.0.1", args.port, 0)

    app.reqCurrentTime()
    app.reqManagedAccts()
    app.reqAccountSummary(reqId=2, groupName="All", tags="NetLiquidation")

    app.reqAllOpenOrders()

    contract = Contract()
    contract.symbol = "AMD"
    contract.secType = "STK"
    contract.currency = "USD"
    contract.exchange = "SMART"
    # app.reqMarketDataType(1)
    # app.reqMktData(1001, contract, "", snapshot=True)
    # app.cancelMktData(1001)
    # app.reqExecutions(2001, ExecutionFilter())
    # app.reqContractDetails(3001, contract)
    # app.reqPositions()
    # app.reqIds(2)

    # app.reqMktDepth(4001, contract, 5, "")
    # app.cancelMktDepth(4001)

    # app.reqNewsBulletins(allMsgs=True)
    # app.cancelNewsBulletins()
    # app.requestFA(FaDataTypeEnum.GROUPS)

    # app.reqHistoricalData(5001, contract, "20161215 16:00:00", "2 D",
    #                             "1 hour", "TRADES", 0, 1, [])
    # app.cancelHistoricalData(5001)

    # app.reqFundamentalData(6001, contract, "ReportSnapshot")
    # app.cancelFundamentalData(6001)
    # app.queryDisplayGroups(7001)
    # app.subscribeToGroupEvents(7002, 1)
    # app.unsubscribeFromGroupEvents(7002)

    # app.reqScannerParameters()
    ss = ScannerSubscription()
    ss.instrument = "STK"
    ss.locationCode = "STK.US"
    ss.scanCode = "TOP_PERC_LOSE"
    # app.reqScannerSubscription(8001, ss, [])
    # app.cancelScannerSubscription(8001)
    # app.reqRealTimeBars(9001, contract, 5, "TRADES", 0, [])
    # app.cancelRealTimeBars(9001)
    # app.reqSecDefOptParams(10001, "AMD", "", "STK", 4391)
    # app.reqSoftDollarTiers(11001)
    # app.reqFamilyCodes()
    # app.reqMatchingSymbols(12001, "AMD")

    contract = Contract()
    contract.symbol = "AMD"
    contract.secType = "OPT"
    contract.exchange = "SMART"
    contract.currency = "USD"
    contract.lastTradeDateOrContractMonth = "20170120"
    contract.strike = 10
    contract.right = "C"
    contract.multiplier = "100"
    # Often, contracts will also require a trading class to rule out ambiguities
    contract.tradingClass = "AMD"
    # app.calculateImpliedVolatility(13001, contract, 1.3, 10.85)
    # app.calculateOptionPrice(13002, contract, 0.65, 10.85)

    app.run()


if __name__ == "__main__":
    main()
