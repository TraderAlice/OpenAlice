"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

from ibapi.object_implem import Object
from ibapi.const import UNSET_DECIMAL, UNSET_DOUBLE

from ibapi.utils import intMaxString
from ibapi.utils import floatMaxString
from ibapi.utils import decimalMaxString
from enum import Enum

"""
SAME_POS    = open/close leg value is same as combo
OPEN_POS    = open
CLOSE_POS   = close
UNKNOWN_POS = unknown
"""
(SAME_POS, OPEN_POS, CLOSE_POS, UNKNOWN_POS) = range(4)


class ComboLeg(Object):
    def __init__(self):
        self.conId = 0  # type: int
        self.ratio = 0  # type: int
        self.action = ""  # BUY/SELL/SHORT
        self.exchange = ""
        self.openClose = 0  # type: int # LegOpenClose enum values
        # for stock legs when doing short sale
        self.shortSaleSlot = 0
        self.designatedLocation = ""
        self.exemptCode = -1

    def __str__(self):
        return ",".join(
            (
                intMaxString(self.conId),
                intMaxString(self.ratio),
                str(self.action),
                str(self.exchange),
                intMaxString(self.openClose),
                intMaxString(self.shortSaleSlot),
                str(self.designatedLocation),
                intMaxString(self.exemptCode),
            )
        )


class DeltaNeutralContract(Object):
    def __init__(self):
        self.conId = 0  # type: int
        self.delta = 0.0  # type: float
        self.price = 0.0  # type: float

    def __str__(self):
        return ",".join(
            (str(self.conId), floatMaxString(self.delta), floatMaxString(self.price))
        )


class Contract(Object):
    def __init__(self):
        self.conId = 0
        self.symbol = ""
        self.secType = ""
        self.lastTradeDateOrContractMonth = ""
        self.lastTradeDate = ""
        self.strike = UNSET_DOUBLE  # float !!
        self.right = ""
        self.multiplier = ""
        self.exchange = ""
        self.primaryExchange = ""  # pick an actual (ie non-aggregate) exchange that the contract trades on.
        # DO NOT SET TO SMART.
        self.currency = ""
        self.localSymbol = ""
        self.tradingClass = ""
        self.includeExpired = False
        self.secIdType = ""  # CUSIP;SEDOL;ISIN;RIC
        self.secId = ""
        self.description = ""
        self.issuerId = ""

        # combos
        self.comboLegsDescrip = (
            ""
        )  # type: str #received in open order 14 and up for all combos
        self.comboLegs = []  # type: list[ComboLeg]
        self.deltaNeutralContract = None

    def __str__(self):
        s = (
            "ConId: %s, Symbol: %s, SecType: %s, LastTradeDateOrContractMonth: %s, Strike: %s, Right: %s, Multiplier: %s, Exchange: %s, PrimaryExchange: %s, "
            "Currency: %s, LocalSymbol: %s, TradingClass: %s, IncludeExpired: %s, SecIdType: %s, SecId: %s, Description: %s, "
            "IssuerId: %s"
            % (
                intMaxString(self.conId),
                str(self.symbol),
                str(self.secType),
                str(self.lastTradeDateOrContractMonth),
                floatMaxString(self.strike),
                str(self.right),
                str(self.multiplier),
                str(self.exchange),
                str(self.primaryExchange),
                str(self.currency),
                str(self.localSymbol),
                str(self.tradingClass),
                str(self.includeExpired),
                str(self.secIdType),
                str(self.secId),
                str(self.description),
                str(self.issuerId),
            )
        )
        s += "Combo:" + self.comboLegsDescrip

        if self.comboLegs:
            for leg in self.comboLegs:
                s += ";" + str(leg)

        if self.deltaNeutralContract:
            s += ";" + str(self.deltaNeutralContract)

        return s


class ContractDetails(Object):
    def __init__(self):
        self.contract = Contract()
        self.marketName = ""
        self.minTick = 0.0
        self.orderTypes = ""
        self.validExchanges = ""
        self.priceMagnifier = 0
        self.underConId = 0
        self.longName = ""
        self.contractMonth = ""
        self.industry = ""
        self.category = ""
        self.subcategory = ""
        self.timeZoneId = ""
        self.tradingHours = ""
        self.liquidHours = ""
        self.evRule = ""
        self.evMultiplier = 0
        self.aggGroup = 0
        self.underSymbol = ""
        self.underSecType = ""
        self.marketRuleIds = ""
        self.secIdList = None
        self.realExpirationDate = ""
        self.lastTradeTime = ""
        self.stockType = ""
        self.minSize = UNSET_DECIMAL
        self.sizeIncrement = UNSET_DECIMAL
        self.suggestedSizeIncrement = UNSET_DECIMAL
        self.minAlgoSize = UNSET_DECIMAL
        self.lastPricePrecision = UNSET_DECIMAL
        self.lastSizePrecision = UNSET_DECIMAL
        # BOND values
        self.cusip = ""
        self.ratings = ""
        self.descAppend = ""
        self.bondType = ""
        self.couponType = ""
        self.callable = False
        self.putable = False
        self.coupon = 0
        self.convertible = False
        self.maturity = ""
        self.issueDate = ""
        self.nextOptionDate = ""
        self.nextOptionType = ""
        self.nextOptionPartial = False
        self.notes = ""
        # FUND values
        self.fundName = ""
        self.fundFamily = ""
        self.fundType = ""
        self.fundFrontLoad = ""
        self.fundBackLoad = ""
        self.fundBackLoadTimeInterval = ""
        self.fundManagementFee = ""
        self.fundClosed = False
        self.fundClosedForNewInvestors = False
        self.fundClosedForNewMoney = False
        self.fundNotifyAmount = ""
        self.fundMinimumInitialPurchase = ""
        self.fundSubsequentMinimumPurchase = ""
        self.fundBlueSkyStates = ""
        self.fundBlueSkyTerritories = ""
        self.fundDistributionPolicyIndicator = FundDistributionPolicyIndicator.NoneItem
        self.fundAssetType = FundAssetType.NoneItem
        self.ineligibilityReasonList = None
        self.eventContract1 = ""
        self.eventContractDescription1 = ""
        self.eventContractDescription2 = ""

    def __str__(self):
        s = ",".join(
            (
                str(self.contract),
                str(self.marketName),
                floatMaxString(self.minTick),
                str(self.orderTypes),
                str(self.validExchanges),
                intMaxString(self.priceMagnifier),
                intMaxString(self.underConId),
                str(self.longName),
                str(self.contractMonth),
                str(self.industry),
                str(self.category),
                str(self.subcategory),
                str(self.timeZoneId),
                str(self.tradingHours),
                str(self.liquidHours),
                str(self.evRule),
                intMaxString(self.evMultiplier),
                str(self.underSymbol),
                str(self.underSecType),
                str(self.marketRuleIds),
                intMaxString(self.aggGroup),
                str(self.secIdList),
                str(self.realExpirationDate),
                str(self.stockType),
                str(self.cusip),
                str(self.ratings),
                str(self.descAppend),
                str(self.bondType),
                str(self.couponType),
                str(self.callable),
                str(self.putable),
                str(self.coupon),
                str(self.convertible),
                str(self.maturity),
                str(self.issueDate),
                str(self.nextOptionDate),
                str(self.nextOptionType),
                str(self.nextOptionPartial),
                str(self.notes),
                decimalMaxString(self.minSize),
                decimalMaxString(self.sizeIncrement),
                decimalMaxString(self.suggestedSizeIncrement),
                decimalMaxString(self.minAlgoSize),
                decimalMaxString(self.lastPricePrecision),
                decimalMaxString(self.lastSizePrecision),
                str(self.ineligibilityReasonList),
                str(self.eventContract1),
                str(self.eventContractDescription1),
                str(self.eventContractDescription2),
            )
        )

        return s


class ContractDescription(Object):
    def __init__(self):
        self.contract = Contract()
        self.derivativeSecTypes = []  # type: list[str]

class FundAssetType(Enum):
    NoneItem = ("None", "None")
    Others = ("000", "Others"), 
    MoneyMarket = ("001", "Money Market")
    FixedIncome = ("002", "Fixed Income")
    MultiAsset = ("003", "Multi-asset")
    Equity = ("004", "Equity")
    Sector = ("005", "Sector")
    Guaranteed = ("006", "Guaranteed")
    Alternative = ("007", "Alternative")

class FundDistributionPolicyIndicator(Enum):
    NoneItem = ("None", "None")
    AccumulationFund = ("N", "Accumulation Fund")
    IncomeFund = ("Y", "Income Fund")
