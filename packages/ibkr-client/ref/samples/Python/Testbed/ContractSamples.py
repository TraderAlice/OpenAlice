"""
Copyright (C) 2024 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

from ibapi.contract import * # @UnusedWildImport


class ContractSamples:

    """ Usually, the easiest way to define a Stock/CASH contract is through 
    these four attributes.  """

    @staticmethod
    def EurGbpFx():
        #! [cashcontract]
        contract = Contract()
        contract.symbol = "EUR"
        contract.secType = "CASH"
        contract.currency = "GBP"
        contract.exchange = "IDEALPRO"
        #! [cashcontract]
        return contract


    @staticmethod
    def Index():
        #! [indcontract]
        contract = Contract()
        contract.symbol = "DAX"
        contract.secType = "IND"
        contract.currency = "EUR"
        contract.exchange = "EUREX"
        #! [indcontract]
        return contract


    @staticmethod
    def CFD():
        #! [cfdcontract]
        contract = Contract()
        contract.symbol = "IBDE30"
        contract.secType = "CFD"
        contract.currency = "EUR"
        contract.exchange = "SMART"
        #! [cfdcontract]
        return contract


    @staticmethod
    def EuropeanStock():
        contract = Contract()
        contract.symbol = "BMW"
        contract.secType = "STK"
        contract.currency = "EUR"
        contract.exchange = "SMART"
        contract.primaryExchange = "IBIS"
        return contract

    @staticmethod
    def EuropeanStock2():
        contract = Contract()
        contract.symbol = "NOKIA"
        contract.secType = "STK"
        contract.currency = "EUR"
        contract.exchange = "SMART"
        contract.primaryExchange = "HEX"
        return contract

    @staticmethod
    def OptionAtIse():
        contract = Contract()
        contract.symbol = "COF"
        contract.secType = "OPT"
        contract.currency = "USD"
        contract.exchange = "ISE"
        contract.lastTradeDateOrContractMonth = "20190315"
        contract.right = "P"
        contract.strike = 105
        contract.multiplier = "100"
        return contract


    @staticmethod
    def BondWithCusip():
        #! [bondwithcusip]
        contract = Contract()
        # enter CUSIP as symbol
        contract.symbol= "449276AA2"
        contract.secType = "BOND"
        contract.exchange = "SMART"
        contract.currency = "USD"
        #! [bondwithcusip]
        return contract


    @staticmethod
    def Bond():
        #! [bond]
        contract = Contract()
        contract.conId = 456467716
        contract.exchange = "SMART"
        #! [bond]
        return contract


    @staticmethod
    def MutualFund():
        #! [fundcontract]
        contract = Contract()
        contract.symbol = "VINIX"
        contract.secType = "FUND"
        contract.exchange = "FUNDSERV"
        contract.currency = "USD"
        #! [fundcontract]
        return contract


    @staticmethod
    def Commodity():
        #! [commoditycontract]
        contract = Contract()
        contract.symbol = "XAUUSD"
        contract.secType = "CMDTY"
        contract.exchange = "SMART"
        contract.currency = "USD"
        #! [commoditycontract]
        return contract
    

    @staticmethod
    def USStock():
        #! [stkcontract]
        contract = Contract()
        contract.symbol = "SPY"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "ARCA"
        #! [stkcontract]
        return contract


    @staticmethod
    def USStockWithPrimaryExch():
        #! [stkcontractwithprimary]
        contract = Contract()
        contract.symbol = "SPY"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "SMART"
        contract.primaryExchange = "ARCA"
        #! [stkcontractwithprimary]
        return contract

            
    @staticmethod
    def USStockAtSmart():
        contract = Contract()
        contract.symbol = "IBM"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "SMART"
        return contract

    @staticmethod
    def etf():
        contract = Contract()
        contract.symbol = "QQQ"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "SMART"
        return contract

    @staticmethod
    def USOptionContract():
        #! [optcontract_us]
        contract = Contract()
        contract.symbol = "GOOG"
        contract.secType = "OPT"
        contract.exchange = "SMART"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = "20190315"
        contract.strike = 1180
        contract.right = "C"
        contract.multiplier = "100"
        #! [optcontract_us]
        return contract


    @staticmethod
    def OptionAtBOX():
        #! [optcontract]
        contract = Contract()
        contract.symbol = "GOOG"
        contract.secType = "OPT"
        contract.exchange = "BOX"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = "20190315"
        contract.strike = 1180
        contract.right = "C"
        contract.multiplier = "100"
        #! [optcontract]
        return contract


    """ Option contracts require far more information since there are many 
    contracts having the exact same attributes such as symbol, currency, 
    strike, etc. This can be overcome by adding more details such as the 
    trading class"""

    @staticmethod
    def OptionWithTradingClass():
        #! [optcontract_tradingclass]
        contract = Contract()
        contract.symbol = "SANT"
        contract.secType = "OPT"
        contract.exchange = "MEFFRV"
        contract.currency = "EUR"
        contract.lastTradeDateOrContractMonth = "20190621"
        contract.strike = 7.5
        contract.right = "C"
        contract.multiplier = "100"
        contract.tradingClass = "SANEU"
        #! [optcontract_tradingclass]
        return contract


    """ Using the contract's own symbol (localSymbol) can greatly simplify a
    contract description """

    @staticmethod
    def OptionWithLocalSymbol():
        #! [optcontract_localsymbol]
        contract = Contract()
        #Watch out for the spaces within the local symbol!
        contract.localSymbol = "P BMW  20221216 72 M"
        contract.secType = "OPT"
        contract.exchange = "EUREX"
        contract.currency = "EUR"
        #! [optcontract_localsymbol]
        return contract

    """ Dutch Warrants (IOPTs) can be defined using the local symbol or conid 
    """

    @staticmethod
    def DutchWarrant():
        #! [ioptcontract]
        contract = Contract()
        contract.localSymbol = "B881G"
        contract.secType = "IOPT"
        contract.exchange = "SBF"
        contract.currency = "EUR"
        #! [ioptcontract]
        return contract

    """ Future contracts also require an expiration date but are less
    complicated than options."""

    @staticmethod
    def SimpleFuture():
        #! [futcontract]
        contract = Contract()
        contract.symbol = "ES"
        contract.secType = "FUT"
        contract.exchange = "CME"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = "202503"
        #! [futcontract]
        return contract


    """Rather than giving expiration dates we can also provide the local symbol
    attributes such as symbol, currency, strike, etc. """

    @staticmethod
    def FutureWithLocalSymbol():
        #! [futcontract_local_symbol]
        contract = Contract()
        contract.secType = "FUT"
        contract.exchange = "EUREX"
        contract.currency = "EUR"
        contract.localSymbol = "FGBL MAR 23"
        #! [futcontract_local_symbol]
        return contract


    @staticmethod
    def FutureWithMultiplier():
        #! [futcontract_multiplier]
        contract = Contract()
        contract.symbol = "DAX"
        contract.secType = "FUT"
        contract.exchange = "EUREX"
        contract.currency = "EUR"
        contract.lastTradeDateOrContractMonth = "202303"
        contract.multiplier = "1"
        #! [futcontract_multiplier]
        return contract


    """ Note the space in the symbol! """

    @staticmethod
    def WrongContract():
        contract = Contract()
        contract.symbol = " IJR "
        contract.conId = 9579976
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"
        return contract

    @staticmethod
    def FuturesOnOptions():
        #! [fopcontract]
        contract = Contract()
        contract.symbol = "GBL"
        contract.secType = "FOP"
        contract.exchange = "EUREX"
        contract.currency = "EUR"
        contract.lastTradeDateOrContractMonth = "20230224"
        contract.strike = 138
        contract.right = "C"
        contract.multiplier = "1000"
        #! [fopcontract]
        return contract

    @staticmethod
    def Warrants():
        #! [warcontract]
        contract = Contract()
        contract.symbol = "GOOG"
        contract.secType = "WAR"
        contract.exchange = "FWB"
        contract.currency = "EUR"
        contract.lastTradeDateOrContractMonth = "20201117"
        contract.strike = 1500.0
        contract.right = "C"
        contract.multiplier = "0.01"
        #! [warcontract]
        return contract

    """ It is also possible to define contracts based on their ISIN (IBKR STK
    sample). """

    @staticmethod
    def ByISIN():
        contract = Contract()
        contract.secIdType = "ISIN"
        contract.secId = "US45841N1072"
        contract.exchange = "SMART"
        contract.currency = "USD"
        contract.secType = "STK"
        return contract


    """ Or their conId (EUR.uSD sample).
    Note: passing a contract containing the conId can cause problems if one of 
    the other provided attributes does not match 100% with what is in IB's 
    database. This is particularly important for contracts such as Bonds which 
    may change their description from one day to another.
    If the conId is provided, it is best not to give too much information as
    in the example below. """

    @staticmethod
    def ByConId():
        contract = Contract()
        contract.secType = "CASH"
        contract.conId = 12087792
        contract.exchange = "IDEALPRO"
        return contract


    """ Ambiguous contracts are great to use with reqContractDetails. This way
    you can query the whole option chain for an underlying. Bear in mind that
    there are pacing mechanisms in place which will delay any further responses
    from the TWS to prevent abuse. """

    @staticmethod
    def OptionForQuery():
        #! [optionforquery]
        contract = Contract()
        contract.symbol = "FISV"
        contract.secType = "OPT"
        contract.exchange = "SMART"
        contract.currency = "USD"
        #! [optionforquery]
        return contract


    @staticmethod
    def OptionComboContract():
        #! [bagoptcontract]
        contract = Contract()
        contract.symbol = "DBK"
        contract.secType = "BAG"
        contract.currency = "EUR"
        contract.exchange = "EUREX"

        leg1 = ComboLeg()
        leg1.conId = 577164786 #DBK Jun21'24 2 CALL @EUREX
        leg1.ratio = 1
        leg1.action = "BUY"
        leg1.exchange = "EUREX"

        leg2 = ComboLeg()
        leg2.conId = 577164767 #DBK Dec15'23 2 CALL @EUREX
        leg2.ratio = 1
        leg2.action = "SELL"
        leg2.exchange = "EUREX"

        contract.comboLegs = []
        contract.comboLegs.append(leg1)
        contract.comboLegs.append(leg2)
        #! [bagoptcontract]
        return contract


    """ STK Combo contract
    Leg 1: 43645865 - IBKR's STK
    Leg 2: 9408 - McDonald's STK """

    @staticmethod
    def StockComboContract():
        #! [bagstkcontract]
        contract = Contract()
        contract.symbol = "IBKR,MCD"
        contract.secType = "BAG"
        contract.currency = "USD"
        contract.exchange = "SMART"

        leg1 = ComboLeg()
        leg1.conId = 43645865#IBKR STK
        leg1.ratio = 1
        leg1.action = "BUY"
        leg1.exchange = "SMART"

        leg2 = ComboLeg()
        leg2.conId = 9408#MCD STK
        leg2.ratio = 1
        leg2.action = "SELL"
        leg2.exchange = "SMART"

        contract.comboLegs = []
        contract.comboLegs.append(leg1)
        contract.comboLegs.append(leg2)
        #! [bagstkcontract]
        return contract


    """ CBOE Volatility Index Future combo contract """

    @staticmethod
    def FutureComboContract():
        #! [bagfutcontract]
        contract = Contract()
        contract.symbol = "VIX"
        contract.secType = "BAG"
        contract.currency = "USD"
        contract.exchange = "CFE"

        leg1 = ComboLeg()
        leg1.conId = 326501438 # VIX FUT 201903
        leg1.ratio = 1
        leg1.action = "BUY"
        leg1.exchange = "CFE"

        leg2 = ComboLeg()
        leg2.conId = 323072528 # VIX FUT 2019049
        leg2.ratio = 1
        leg2.action = "SELL"
        leg2.exchange = "CFE"

        contract.comboLegs = []
        contract.comboLegs.append(leg1)
        contract.comboLegs.append(leg2)
        #! [bagfutcontract]
        return contract

    @staticmethod
    def SmartFutureComboContract():
        #! [smartfuturespread]
        contract = Contract()
        contract.symbol = "WTI" # WTI,COIL spread. Symbol can be defined as first leg symbol ("WTI") or currency ("USD")
        contract.secType = "BAG"
        contract.currency = "USD"
        contract.exchange = "SMART"

        leg1 = ComboLeg()
        leg1.conId = 55928698 # WTI future June 2017
        leg1.ratio = 1
        leg1.action = "BUY"
        leg1.exchange = "IPE"

        leg2 = ComboLeg()
        leg2.conId = 55850663 # COIL future June 2017
        leg2.ratio = 1
        leg2.action = "SELL"
        leg2.exchange = "IPE"

        contract.comboLegs = []
        contract.comboLegs.append(leg1)
        contract.comboLegs.append(leg2)
        #! [smartfuturespread]
        return contract

    @staticmethod
    def InterCmdtyFuturesContract():
        #! [intcmdfutcontract]
        contract = Contract()
        contract.symbol = "COL.WTI" #symbol is 'local symbol' of intercommodity spread. 
        contract.secType = "BAG"
        contract.currency = "USD"
        contract.exchange = "IPE"

        leg1 = ComboLeg()
        leg1.conId = 183405603 #WTI�Dec'23�@IPE
        leg1.ratio = 1
        leg1.action = "BUY"
        leg1.exchange = "IPE"

        leg2 = ComboLeg()
        leg2.conId = 254011009 #COIL�Dec'23�@IPE
        leg2.ratio = 1
        leg2.action = "SELL"
        leg2.exchange = "IPE"

        contract.comboLegs = []
        contract.comboLegs.append(leg1)
        contract.comboLegs.append(leg2)
        #! [intcmdfutcontract]
        return contract


    @staticmethod
    def NewsFeedForQuery():
        #! [newsfeedforquery]
        contract = Contract()
        contract.secType = "NEWS"
        contract.exchange = "BRFG" #Briefing Trader
        #! [newsfeedforquery]
        return contract


    @staticmethod
    def BTbroadtapeNewsFeed():
        #! [newscontractbt]
        contract = Contract()
        contract.symbol  = "BRF:BRF_ALL"
        contract.secType = "NEWS"
        contract.exchange = "BRF"
        #! [newscontractbt]
        return contract


    @staticmethod
    def BZbroadtapeNewsFeed():
        #! [newscontractbz]
        contract = Contract()
        contract.symbol = "BZ:BZ_ALL"
        contract.secType = "NEWS"
        contract.exchange = "BZ"
        #! [newscontractbz]
        return contract


    @staticmethod
    def FLYbroadtapeNewsFeed():
        #! [newscontractfly]
        contract = Contract()
        contract.symbol  = "FLY:FLY_ALL"
        contract.secType = "NEWS"
        contract.exchange = "FLY"
        #! [newscontractfly]
        return contract


    @staticmethod
    def ContFut():
        #! [continuousfuturescontract]
        contract = Contract()
        contract.symbol = "GBL"
        contract.secType = "CONTFUT"
        contract.exchange = "EUREX"
        #! [continuousfuturescontract]
        return contract

    @staticmethod
    def ContAndExpiringFut():
        #! [contandexpiringfut]
        contract = Contract()
        contract.symbol = "GBL"
        contract.secType = "FUT+CONTFUT"
        contract.exchange = "EUREX"
        #! [contandexpiringfut]
        return contract

    @staticmethod
    def JefferiesContract():
        #! [jefferies_contract]
        contract = Contract()
        contract.symbol = "AAPL"
        contract.secType = "STK"
        contract.exchange = "JEFFALGO"
        contract.currency = "USD"
        #! [jefferies_contract]
        return contract

    @staticmethod
    def CSFBContract():
        #! [csfb_contract]
        contract = Contract()
        contract.symbol = "IBKR"
        contract.secType = "STK"
        contract.exchange = "CSFBALGO"
        contract.currency = "USD"
        #! [csfb_contract]
        return contract

    @staticmethod
    def USStockCFD():
        # ! [usstockcfd_conract]
        contract = Contract()
        contract.symbol = "IBM"
        contract.secType = "CFD"
        contract.currency = "USD"
        contract.exchange = "SMART"
        # ! [usstockcfd_conract]
        return contract

    @staticmethod
    def EuropeanStockCFD():
        # ! [europeanstockcfd_contract]
        contract = Contract()
        contract.symbol = "BMW"
        contract.secType = "CFD"
        contract.currency = "EUR"
        contract.exchange = "SMART"
        # ! [europeanstockcfd_contract]
        return contract

    @staticmethod
    def CashCFD():
        # ! [cashcfd_contract]
        contract = Contract()
        contract.symbol = "EUR"
        contract.secType = "CFD"
        contract.currency = "USD"
        contract.exchange = "SMART"
        # ! [cashcfd_contract]
        return contract

    @staticmethod
    def QBAlgoContract():
        # ! [qbalgo_contract]
        contract = Contract()
        contract.symbol = "ES"
        contract.secType = "FUT"
        contract.exchange = "QBALGO"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = "202003"
        # ! [qbalgo_contract]
        return contract

    @staticmethod
    def IBKRATSContract():
        # ! [ibkrats_contract]
        contract = Contract()
        contract.symbol = "SPY"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "IBKRATS"
        # ! [ibkrats_contract]
        return contract

    @staticmethod
    def CryptoContract():
        # ! [crypto_contract]
        contract = Contract()
        contract.symbol = "ETH"
        contract.secType = "CRYPTO"
        contract.currency = "USD"
        contract.exchange = "PAXOS"
        # ! [crypto_contract]
        return contract

    @staticmethod
    def StockWithIPOPrice():
        # ! [stock_with_IPO_price]
        contract = Contract()
        contract.symbol = "EMCGU"
        contract.secType = "STK"
        contract.currency = "USD"
        contract.exchange = "SMART"
        # ! [stock_with_IPO_price]
        return contract

    @staticmethod
    def ByFIGI():
        # ! [ByFIGI]
        contract = Contract()
        contract.secIdType = "FIGI"
        contract.secId = "BBG000B9XRY4"
        contract.exchange = "SMART"
        # ! [ByFIGI]
        return contract
        
    @staticmethod
    def ByIssuerId():
        # ! [ByIssuerId]
        contract = Contract()
        contract.issuerId = "e1453318"
        # ! [ByIssuerId]
        return contract

    @staticmethod
    def FundContract():
        # ! [fundcontract]
        contract = Contract()
        contract.symbol = "I406801954"
        contract.secType = "FUND"
        contract.exchange = "ALLFUNDS"
        contract.currency = "USD"
        # ! [fundcontract]
        return contract

    @staticmethod
    def OptForecastx():
        # ! [optforecastxcontract]
        contract = Contract()
        contract.symbol = "CPIY"
        contract.secType = "OPT"
        contract.lastTradeDateOrContractMonth = "202612"
        contract.exchange = "FORECASTX"
        contract.currency = "USD"
        # ! [optforecastxcontract]
        return contract

    @staticmethod
    def OptForecastxZeroStrike():
        # ! [optforecastxcontract]
        contract = Contract()
        contract.symbol = "CPIY"
        contract.secType = "OPT"
        contract.lastTradeDateOrContractMonth = "202612"
        contract.strike = 0
        contract.right = "C"
        contract.exchange = "FORECASTX"
        contract.currency = "USD"
        # ! [optforecastxcontract]
        return contract

    @staticmethod
    def OptForecastxByConId():
        # ! [optforecastxbyconid]
        contract = Contract()
        contract.conId = 789013783
        contract.exchange = "FORECASTX"
        # ! [optforecastxbyconid]
        return contract

def Test():
    from ibapi.utils import ExerciseStaticMethods
    ExerciseStaticMethods(ContractSamples)


if "__main__" == __name__:
    Test()

