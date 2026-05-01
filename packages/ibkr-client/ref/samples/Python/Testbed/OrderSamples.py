"""
Copyright (C) 2025 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""


from ibapi.order import (OrderComboLeg, Order, COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID)
from ibapi.common import * # @UnusedWildImport
from ibapi.tag_value import TagValue
from ibapi import order_condition
from ibapi.order_condition import * # @UnusedWildImport
from ibapi.order_cancel import OrderCancel
from decimal import Decimal


class OrderSamples:

    """ <summary>
    #/ An auction order is entered into the electronic trading system during the pre-market opening period for execution at the 
    #/ Calculated Opening Price (COP). If your order is not filled on the open, the order is re-submitted as a limit order with 
    #/ the limit price set to the COP or the best bid/ask after the market opens.
    #/ Products: FUT, STK
    </summary>"""
    @staticmethod
    def AtAuction(action:str, quantity:Decimal, price:float):
        #! [auction]
        order = Order()
        order.action = action
        order.tif = "AUC"
        order.orderType = "MTL"
        order.totalQuantity = quantity
        order.lmtPrice = price
        #! [auction]
        return order

    """ <summary>
    #/ A Discretionary order is a limit order submitted with a hidden, specified 'discretionary' amount off the limit price which
    #/ may be used to increase the price range over which the limit order is eligible to execute. The market sees only the limit price.
    #/ Products: STK
    </summary>"""
    @staticmethod
    def Discretionary(action:str, quantity:Decimal, price:float, discretionaryAmount:float):
    
        #! [discretionary]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = price
        order.discretionaryAmt = discretionaryAmount
        #! [discretionary]
        return order
    

    """ <summary>
    #/ A Market order is an order to buy or sell at the market bid or offer price. A market order may increase the likelihood of a fill 
    #/ and the speed of execution, but unlike the Limit order a Market order provides no price protection and may fill at a price far 
    #/ lower/higher than the current displayed bid/ask.
    #/ Products: BOND, CFD, EFP, CASH, FUND, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def MarketOrder(action:str, quantity:Decimal):
    
        #! [market]
        order = Order()
        order.action = action
        order.orderType = "MKT"
        order.totalQuantity = quantity
        #! [market]
        return order
    

    """ <summary>
    #/ A Market if Touched (MIT) is an order to buy (or sell) a contract below (or above) the market. Its purpose is to take advantage 
    #/ of sudden or unexpected changes in share or other prices and provides investors with a trigger price to set an order in motion. 
    #/ Investors may be waiting for excessive strength (or weakness) to cease, which might be represented by a specific price point. 
    #/ MIT orders can be used to determine whether or not to enter the market once a specific price level has been achieved. This order 
    #/ is held in the system until the trigger price is touched, and is then submitted as a market order. An MIT order is similar to a 
    #/ stop order, except that an MIT sell order is placed above the current market price, and a stop sell order is placed below
    #/ Products: BOND, CFD, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def MarketIfTouched(action:str, quantity:Decimal, price:float):
    
        #! [market_if_touched]
        order = Order()
        order.action = action
        order.orderType = "MIT"
        order.totalQuantity = quantity
        order.auxPrice = price
        #! [market_if_touched]
        return order
    

    """ <summary>
    #/ A Market-on-Close (MOC) order is a market order that is submitted to execute as close to the closing price as possible.
    #/ Products: CFD, FUT, STK, WAR
    </summary>"""
    @staticmethod
    def MarketOnClose(action:str, quantity:Decimal):
    
        #! [market_on_close]
        order = Order()
        order.action = action
        order.orderType = "MOC"
        order.totalQuantity = quantity
        #! [market_on_close]
        return order
    

    """ <summary>
    #/ A Market-on-Open (MOO) order combines a market order with the OPG time in force to create an order that is automatically
    #/ submitted at the market's open and fills at the market price.
    #/ Products: CFD, STK, OPT, WAR
    </summary>"""
    @staticmethod
    def MarketOnOpen(action:str, quantity:Decimal):
    
        #! [market_on_open]
        order = Order()
        order.action = action
        order.orderType = "MKT"
        order.totalQuantity = quantity
        order.tif = "OPG"
        #! [market_on_open]
        return order
    

    """ <summary>
    #/ ISE MidpoMatch:int (MPM) orders always execute at the midpoof:the:int NBBO. You can submit market and limit orders direct-routed 
    #/ to ISE for MPM execution. Market orders execute at the midpowhenever:an:int eligible contra-order is available. Limit orders 
    #/ execute only when the midpoprice:is:int better than the limit price. Standard MPM orders are completely anonymous.
    #/ Products: STK
    </summary>"""
    @staticmethod
    def MidpointMatch(action:str, quantity:Decimal):
    
        #! [midpoint_match]
        order = Order()
        order.action = action
        order.orderType = "MKT"
        order.totalQuantity = quantity
        #! [midpoint_match]
        return order
    

    """ <summary>
	#/ A Midprice order is designed to split the difference between the bid and ask prices, and fill at the current midpoint of 
	#/ the NBBO or better. Set an optional price cap to define the highest price (for a buy order) or the lowest price (for a sell 
	#/ order) you are willing to accept. Requires TWS 975+. Smart-routing to US stocks only.
    </summary>"""
    @staticmethod
    def Midprice(action:str, quantity:Decimal, priceCap:float):
    
        #! [midprice]
        order = Order()
        order.action = action
        order.orderType = "MIDPRICE"
        order.totalQuantity = quantity
        order.lmtPrice = priceCap # optional
        #! [midprice]
        return order

    """ <summary>
    #/ A pegged-to-market order is designed to maintain a purchase price relative to the national best offer (NBO) or a sale price 
    #/ relative to the national best bid (NBB). Depending on the width of the quote, this order may be passive or aggressive. 
    #/ The trader creates the order by entering a limit price which defines the worst limit price that they are willing to accept. 
    #/ Next, the trader enters an offset amount which computes the active limit price as follows:
    #/     Sell order price = Bid price + offset amount
    #/     Buy order price = Ask price - offset amount
    #/ Products: STK
    </summary>"""
    @staticmethod
    def PeggedToMarket(action:str, quantity:Decimal, marketOffset:float):
    
        #! [pegged_market]
        order = Order()
        order.action = action
        order.orderType = "PEG MKT"
        order.totalQuantity = quantity
        order.auxPrice = marketOffset#Offset price
        #! [pegged_market]
        return order
    

    """ <summary>
    #/ A Pegged to Stock order continually adjusts the option order price by the product of a signed user-define delta and the change of 
    #/ the option's underlying stock price. The delta is entered as an absolute and assumed to be positive for calls and negative for puts. 
    #/ A buy or sell call order price is determined by adding the delta times a change in an underlying stock price to a specified starting 
    #/ price for the call. To determine the change in price, the stock reference price is subtracted from the current NBBO midpoint. 
    #/ The Stock Reference Price can be defined by the user, or defaults to the NBBO midpoat:the:int time of the order if no reference price 
    #/ is entered. You may also enter a high/low stock price range which cancels the order when reached. The delta times the change in stock 
    #/ price will be rounded to the nearest penny in favor of the order.
    #/ Products: OPT
    </summary>"""
    @staticmethod
    def PeggedToStock(action:str, quantity:Decimal, delta:float, stockReferencePrice:float, startingPrice:float):
    
        #! [pegged_stock]
        order = Order()
        order.action = action
        order.orderType = "PEG STK"
        order.totalQuantity = quantity
        order.delta = delta
        order.stockRefPrice = stockReferencePrice
        order.startingPrice = startingPrice
        #! [pegged_stock]
        return order
    

    """ <summary>
    #/ Relative (a.k.a. Pegged-to-Primary) orders provide a means for traders to seek a more aggressive price than the National Best Bid 
    #/ and Offer (NBBO). By acting as liquidity providers, and placing more aggressive bids and offers than the current best bids and offers, 
    #/ traders increase their odds of filling their order. Quotes are automatically adjusted as the markets move, to remain aggressive. 
    #/ For a buy order, your bid is pegged to the NBB by a more aggressive offset, and if the NBB moves up, your bid will also move up. 
    #/ If the NBB moves down, there will be no adjustment because your bid will become even more aggressive and execute. For sales, your 
    #/ offer is pegged to the NBO by a more aggressive offset, and if the NBO moves down, your offer will also move down. If the NBO moves up, 
    #/ there will be no adjustment because your offer will become more aggressive and execute. In addition to the offset, you can define an 
    #/ absolute cap, which works like a limit price, and will prevent your order from being executed above or below a specified level.
    #/ Stocks, Options and Futures - not available on paper trading
    #/ Products: CFD, STK, OPT, FUT
    </summary>"""
    @staticmethod
    def RelativePeggedToPrimary(action:str, quantity:Decimal, priceCap:float, 
                                offsetAmount:float):
    
        #! [relative_pegged_primary]
        order = Order()
        order.action = action
        order.orderType = "REL"
        order.totalQuantity = quantity
        order.lmtPrice = priceCap
        order.auxPrice = offsetAmount
        #! [relative_pegged_primary]
        return order
    

    """ <summary>
    #/ Sweep-to-fill orders are useful when a trader values speed of execution over price. A sweep-to-fill order identifies the best price 
    #/ and the exact quantity offered/available at that price, and transmits the corresponding portion of your order for immediate execution. 
    #/ Simultaneously it identifies the next best price and quantity offered/available, and submits the matching quantity of your order for 
    #/ immediate execution.
    #/ Products: CFD, STK, WAR
    </summary>"""
    @staticmethod
    def SweepToFill(action:str, quantity:Decimal, price:float):
    
        #! [sweep_to_fill]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = price
        order.sweepToFill = True
        #! [sweep_to_fill]
        return order
    

    """ <summary>
    #/ For option orders routed to the Boston Options Exchange (BOX) you may elect to participate in the BOX's price improvement auction in 
    #/ pennies. All BOX-directed price improvement orders are immediately sent from Interactive Brokers to the BOX order book, and when the 
    #/ terms allow, IB will evaluate it for inclusion in a price improvement auction based on price and volume priority. In the auction, your 
    #/ order will have priority over broker-dealer price improvement orders at the same price.
    #/ An Auction Limit order at a specified price. Use of a limit order ensures that you will not receive an execution at a price less favorable 
    #/ than the limit price. Enter limit orders in penny increments with your auction improvement amount computed as the difference between your 
    #/ limit order price and the nearest listed increment.
    #/ Products: OPT
    #/ Supported Exchanges: BOX
    </summary>"""
    @staticmethod
    def AuctionLimit(action:str, quantity:Decimal, price:float, 
                     auctionStrategy:int):
    
        #! [auction_limit]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = price
        order.auctionStrategy = auctionStrategy
        #! [auction_limit]
        return order
    

    """ <summary>
    #/ For option orders routed to the Boston Options Exchange (BOX) you may elect to participate in the BOX's price improvement auction in pennies. 
    #/ All BOX-directed price improvement orders are immediately sent from Interactive Brokers to the BOX order book, and when the terms allow, 
    #/ IB will evaluate it for inclusion in a price improvement auction based on price and volume priority. In the auction, your order will have 
    #/ priority over broker-dealer price improvement orders at the same price.
    #/ An Auction Pegged to Stock order adjusts the order price by the product of a signed delta (which is entered as an absolute and assumed to be 
    #/ positive for calls, negative for puts) and the change of the option's underlying stock price. A buy or sell call order price is determined 
    #/ by adding the delta times a change in an underlying stock price change to a specified starting price for the call. To determine the change 
    #/ in price, a stock reference price (NBBO midpoat:the:int time of the order is assumed if no reference price is entered) is subtracted from 
    #/ the current NBBO midpoint. A stock range may also be entered that cancels an order when reached. The delta times the change in stock price 
    #/ will be rounded to the nearest penny in favor of the order and will be used as your auction improvement amount.
    #/ Products: OPT
    #/ Supported Exchanges: BOX
    </summary>"""
    @staticmethod
    def AuctionPeggedToStock(action:str, quantity:Decimal, startingPrice:float, 
                             delta:float):
    
        #! [auction_pegged_stock]
        order = Order()
        order.action = action
        order.orderType = "PEG STK"
        order.totalQuantity = quantity
        order.delta = delta
        order.startingPrice = startingPrice
        #! [auction_pegged_stock]
        return order
    

    """ <summary>
    #/ For option orders routed to the Boston Options Exchange (BOX) you may elect to participate in the BOX's price improvement auction in pennies. 
    #/ All BOX-directed price improvement orders are immediately sent from Interactive Brokers to the BOX order book, and when the terms allow, 
    #/ IB will evaluate it for inclusion in a price improvement auction based on price and volume priority. In the auction, your order will have 
    #/ priority over broker-dealer price improvement orders at the same price.
    #/ An Auction Relative order that adjusts the order price by the product of a signed delta (which is entered as an absolute and assumed to be 
    #/ positive for calls, negative for puts) and the change of the option's underlying stock price. A buy or sell call order price is determined 
    #/ by adding the delta times a change in an underlying stock price change to a specified starting price for the call. To determine the change 
    #/ in price, a stock reference price (NBBO midpoat:the:int time of the order is assumed if no reference price is entered) is subtracted from 
    #/ the current NBBO midpoint. A stock range may also be entered that cancels an order when reached. The delta times the change in stock price 
    #/ will be rounded to the nearest penny in favor of the order and will be used as your auction improvement amount.
    #/ Products: OPT
    #/ Supported Exchanges: BOX
    </summary>"""
    @staticmethod
    def AuctionRelative(action:str, quantity:Decimal, offset:float):
    
        #! [auction_relative]
        order = Order()
        order.action = action
        order.orderType = "REL"
        order.totalQuantity = quantity
        order.auxPrice = offset
        #! [auction_relative]
        return order
    

    """ <summary>
    #/ The Block attribute is used for large volume option orders on ISE that consist of at least 50 contracts. To execute large-volume 
    #/ orders over time without moving the market, use the Accumulate/Distribute algorithm.
    #/ Products: OPT
    </summary>"""
    @staticmethod
    def Block(action:str, quantity:Decimal, price:float):
    
        # ! [block]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity#Large volumes!
        order.lmtPrice = price
        order.blockOrder = True
        # ! [block]
        return order
    

    """ <summary>
    #/ A Box Top order executes as a market order at the current best price. If the order is only partially filled, the remainder is submitted as 
    #/ a limit order with the limit price equal to the price at which the filled portion of the order executed.
    #/ Products: OPT
    #/ Supported Exchanges: BOX
    </summary>"""
    @staticmethod
    def BoxTop(action:str, quantity:Decimal):
    
        # ! [boxtop]
        order = Order()
        order.action = action
        order.orderType = "BOX TOP"
        order.totalQuantity = quantity
        # ! [boxtop]
        return order
    

    """ <summary>
    #/ A Limit order is an order to buy or sell at a specified price or better. The Limit order ensures that if the order fills, 
    #/ it will not fill at a price less favorable than your limit price, but it does not guarantee a fill.
    #/ Products: BOND, CFD, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def LimitOrder(action:str, quantity:Decimal, limitPrice:float):
    
        # ! [limitorder]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        order.tif = "DAY"
        # ! [limitorder]
        return order
        
    """ <summary>            
    #/ Forex orders can be placed in demonination of second currency in pair using cashQty field
    #/ Requires TWS or IBG 963+
    #/ https://www.interactivebrokers.com/en/index.php?f=23876#963-02
    </summary>"""
        
    @staticmethod
    def LimitOrderWithCashQty(action:str, limitPrice:float, cashQty:float):
    
        # ! [limitorderwithcashqty]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.lmtPrice = limitPrice
        order.cashQty = cashQty
        # ! [limitorderwithcashqty]
        return order


    """ <summary>
    #/ A Limit if Touched is an order to buy (or sell) a contract at a specified price or better, below (or above) the market. This order is 
    #/ held in the system until the trigger price is touched. An LIT order is similar to a stop limit order, except that an LIT sell order is 
    #/ placed above the current market price, and a stop limit sell order is placed below.
    #/ Products: BOND, CFD, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def LimitIfTouched(action:str, quantity:Decimal, limitPrice:float, 
                        triggerPrice:float):
    
        # ! [limitiftouched]
        order = Order()
        order.action = action
        order.orderType = "LIT"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        order.auxPrice = triggerPrice
        # ! [limitiftouched]
        return order
    

    """ <summary>
    #/ A Limit-on-close (LOC) order will be submitted at the close and will execute if the closing price is at or better than the submitted 
    #/ limit price.
    #/ Products: CFD, FUT, STK, WAR
    </summary>"""
    @staticmethod
    def LimitOnClose(action:str, quantity:Decimal, limitPrice:float):
    
        # ! [limitonclose]
        order = Order()
        order.action = action
        order.orderType = "LOC"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        # ! [limitonclose]
        return order
    

    """ <summary>
    #/ A Limit-on-Open (LOO) order combines a limit order with the OPG time in force to create an order that is submitted at the market's open, 
    #/ and that will only execute at the specified limit price or better. Orders are filled in accordance with specific exchange rules.
    #/ Products: CFD, STK, OPT, WAR
    </summary>"""
    @staticmethod
    def LimitOnOpen(action:str, quantity:Decimal, limitPrice:float):
    
        # ! [limitonopen]
        order = Order()
        order.action = action
        order.tif = "OPG"
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        # ! [limitonopen]
        return order
    

    """ <summary>
    #/ Passive Relative orders provide a means for traders to seek a less aggressive price than the National Best Bid and Offer (NBBO) while 
    #/ keeping the order pegged to the best bid (for a buy) or ask (for a sell). The order price is automatically adjusted as the markets move 
    #/ to keep the order less aggressive. For a buy order, your order price is pegged to the NBB by a less aggressive offset, and if the NBB 
    #/ moves up, your bid will also move up. If the NBB moves down, there will be no adjustment because your bid will become aggressive and execute. 
    #/ For a sell order, your price is pegged to the NBO by a less aggressive offset, and if the NBO moves down, your offer will also move down. 
    #/ If the NBO moves up, there will be no adjustment because your offer will become aggressive and execute. In addition to the offset, you can 
    #/ define an absolute cap, which works like a limit price, and will prevent your order from being executed above or below a specified level. 
    #/ The Passive Relative order is similar to the Relative/Pegged-to-Primary order, except that the Passive relative subtracts the offset from 
    #/ the bid and the Relative adds the offset to the bid.
    #/ Products: STK, WAR
    </summary>"""
    @staticmethod
    def PassiveRelative(action:str, quantity:Decimal, offset:float):
    
        # ! [passive_relative]
        order = Order()
        order.action = action
        order.orderType = "PASSV REL"
        order.totalQuantity = quantity
        order.auxPrice = offset
        # ! [passive_relative]
        return order
    

    """ <summary>
    #/ A pegged-to-midpoorder:provides:int a means for traders to seek a price at the midpoof:the:int National Best Bid and Offer (NBBO). 
    #/ The price automatically adjusts to peg the midpoas:the:int markets move, to remain aggressive. For a buy order, your bid is pegged to 
    #/ the NBBO midpoand:the:int order price adjusts automatically to continue to peg the midpoif:the:int market moves. The price only adjusts 
    #/ to be more aggressive. If the market moves in the opposite direction, the order will execute.
    #/ Products: STK
    </summary>"""
    @staticmethod
    def PeggedToMidpoint(action:str, quantity:Decimal, offset:float, limitPrice:float):
    
        # ! [pegged_midpoint]
        order = Order()
        order.action = action
        order.orderType = "PEG MID"
        order.totalQuantity = quantity
        order.auxPrice = offset
        order.lmtPrice = limitPrice
        # ! [pegged_midpoint]
        return order
    

    """ <summary>
    #/ Bracket orders are designed to help limit your loss and lock in a profit by "bracketing" an order with two opposite-side orders. 
    #/ A BUY order is bracketed by a high-side sell limit order and a low-side sell stop order. A SELL order is bracketed by a high-side buy 
    #/ stop order and a low side buy limit order.
    #/ Products: CFD, BAG, FOP, CASH, FUT, OPT, STK, WAR
    </summary>"""
    #! [bracket]
    @staticmethod
    def BracketOrder(parentOrderId:int, action:str, quantity:Decimal, 
                     limitPrice:float, takeProfitLimitPrice:float, 
                     stopLossPrice:float):
    
        #This will be our main or "parent" order
        parent = Order()
        parent.orderId = parentOrderId
        parent.action = action
        parent.orderType = "LMT"
        parent.totalQuantity = quantity
        parent.lmtPrice = limitPrice
        #The parent and children orders will need this attribute set to False to prevent accidental executions.
        #The LAST CHILD will have it set to True, 
        parent.transmit = False

        takeProfit = Order()
        takeProfit.orderId = parent.orderId + 1
        takeProfit.action = "SELL" if action == "BUY" else "BUY"
        takeProfit.orderType = "LMT"
        takeProfit.totalQuantity = quantity
        takeProfit.lmtPrice = takeProfitLimitPrice
        takeProfit.parentId = parentOrderId
        takeProfit.transmit = False

        stopLoss = Order()
        stopLoss.orderId = parent.orderId + 2
        stopLoss.action = "SELL" if action == "BUY" else "BUY"
        stopLoss.orderType = "STP"
        #Stop trigger price
        stopLoss.auxPrice = stopLossPrice
        stopLoss.totalQuantity = quantity
        stopLoss.parentId = parentOrderId
        #In this case, the low side order will be the last child being sent. Therefore, it needs to set this attribute to True 
        #to activate all its predecessors
        stopLoss.transmit = True

        bracketOrder = [parent, takeProfit, stopLoss]
        return bracketOrder
    
    #! [bracket]

    """ <summary>
    #/ Products:CFD, FUT, FOP, OPT, STK, WAR
    #/ A Market-to-Limit (MTL) order is submitted as a market order to execute at the current best market price. If the order is only 
    #/ partially filled, the remainder of the order is canceled and re-submitted as a limit order with the limit price equal to the price 
    #/ at which the filled portion of the order executed.
    </summary>"""
    @staticmethod
    def MarketToLimit(action:str, quantity:Decimal):
    
        # ! [markettolimit]
        order = Order()
        order.action = action
        order.orderType = "MTL"
        order.totalQuantity = quantity
        # ! [markettolimit]
        return order
    

    """ <summary>
    #/ This order type is useful for futures traders using Globex. A Market with Protection order is a market order that will be cancelled and 
    #/ resubmitted as a limit order if the entire order does not immediately execute at the market price. The limit price is set by Globex to be 
    #/ close to the current market price, slightly higher for a sell order and lower for a buy order.
    #/ Products: FUT, FOP
    </summary>"""
    @staticmethod
    def MarketWithProtection(action:str, quantity:Decimal):
    
        # ! [marketwithprotection]
        order = Order()
        order.action = action
        order.orderType = "MKT PRT"
        order.totalQuantity = quantity
        # ! [marketwithprotection]
        return order
    

    """ <summary>
    #/ A Stop order is an instruction to submit a buy or sell market order if and when the user-specified stop trigger price is attained or 
    #/ penetrated. A Stop order is not guaranteed a specific execution price and may execute significantly away from its stop price. A Sell 
    #/ Stop order is always placed below the current market price and is typically used to limit a loss or protect a profit on a long stock 
    #/ position. A Buy Stop order is always placed above the current market price. It is typically used to limit a loss or help protect a 
    #/ profit on a short sale.
    #/ Products: CFD, BAG, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def Stop(action:str, quantity:Decimal, stopPrice:float):
    
        # ! [stop]
        order = Order()
        order.action = action
        order.orderType = "STP"
        order.auxPrice = stopPrice
        order.totalQuantity = quantity
        # ! [stop]
        return order
    

    """ <summary>
    #/ A Stop-Limit order is an instruction to submit a buy or sell limit order when the user-specified stop trigger price is attained or 
    #/ penetrated. The order has two basic components: the stop price and the limit price. When a trade has occurred at or through the stop 
    #/ price, the order becomes executable and enters the market as a limit order, which is an order to buy or sell at a specified price or better.
    #/ Products: CFD, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def StopLimit(action:str, quantity:Decimal, limitPrice:float, stopPrice:float):
    
        # ! [stoplimit]
        order = Order()
        order.action = action
        order.orderType = "STP LMT"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        order.auxPrice = stopPrice
        # ! [stoplimit]
        return order
    

    """ <summary>
    #/ A Stop with Protection order combines the functionality of a stop limit order with a market with protection order. The order is set 
    #/ to trigger at a specified stop price. When the stop price is penetrated, the order is triggered as a market with protection order, 
    #/ which means that it will fill within a specified protected price range equal to the trigger price +/- the exchange-defined protection 
    #/ porange:int. Any portion of the order that does not fill within this protected range is submitted as a limit order at the exchange-defined 
    #/ trigger price +/- the protection points.
    #/ Products: FUT
    </summary>"""
    @staticmethod
    def StopWithProtection(action:str, quantity:Decimal, stopPrice:float):
    
        # ! [stopwithprotection]
        order = Order()
        order.totalQuantity = quantity
        order.action = action
        order.orderType = "STP PRT"
        order.auxPrice = stopPrice
        # ! [stopwithprotection]
        return order
    

    """ <summary>
    #/ A sell trailing stop order sets the stop price at a fixed amount below the market price with an attached "trailing" amount. As the 
    #/ market price rises, the stop price rises by the trail amount, but if the stock price falls, the stop loss price doesn't change, 
    #/ and a market order is submitted when the stop price is hit. This technique is designed to allow an investor to specify a limit on the 
    #/ maximum possible loss, without setting a limit on the maximum possible gain. "Buy" trailing stop orders are the mirror image of sell 
    #/ trailing stop orders, and are most appropriate for use in falling markets.
    #/ Products: CFD, CASH, FOP, FUT, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def TrailingStop(action:str, quantity:Decimal, trailingPercent:float,
                     trailStopPrice:float):
    
        # ! [trailingstop]
        order = Order()
        order.action = action
        order.orderType = "TRAIL"
        order.totalQuantity = quantity
        order.trailingPercent = trailingPercent
        order.trailStopPrice = trailStopPrice
        # ! [trailingstop]
        return order
    

    """ <summary>
    #/ A trailing stop limit order is designed to allow an investor to specify a limit on the maximum possible loss, without setting a limit 
    #/ on the maximum possible gain. A SELL trailing stop limit moves with the market price, and continually recalculates the stop trigger 
    #/ price at a fixed amount below the market price, based on the user-defined "trailing" amount. The limit order price is also continually 
    #/ recalculated based on the limit offset. As the market price rises, both the stop price and the limit price rise by the trail amount and 
    #/ limit offset respectively, but if the stock price falls, the stop price remains unchanged, and when the stop price is hit a limit order 
    #/ is submitted at the last calculated limit price. A "Buy" trailing stop limit order is the mirror image of a sell trailing stop limit, 
    #/ and is generally used in falling markets.
    #/ Products: BOND, CFD, CASH, FUT, FOP, OPT, STK, WAR
    </summary>"""
    @staticmethod
    def TrailingStopLimit(action:str, quantity:Decimal, lmtPriceOffset:float, 
                          trailingAmount:float, trailStopPrice:float):
    
        # ! [trailingstoplimit]
        order = Order()
        order.action = action
        order.orderType = "TRAIL LIMIT"
        order.totalQuantity = quantity
        order.trailStopPrice = trailStopPrice
        order.lmtPriceOffset = lmtPriceOffset
        order.auxPrice = trailingAmount
        # ! [trailingstoplimit]
        return order
    

    """ <summary>
    #/ Create combination orders that include options, stock and futures legs (stock legs can be included if the order is routed 
    #/ through SmartRouting). Although a combination/spread order is constructed of separate legs, it is executed as a single transaction 
    #/ if it is routed directly to an exchange. For combination orders that are SmartRouted, each leg may be executed separately to ensure 
    #/ best execution.
    #/ Products: OPT, STK, FUT
    </summary>"""
    @staticmethod
    def ComboLimitOrder(action:str, quantity:Decimal, limitPrice:float, 
                        nonGuaranteed:bool):
    
        # ! [combolimit]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        if nonGuaranteed:
        
            order.smartComboRoutingParams = []
            order.smartComboRoutingParams.append(TagValue("NonGuaranteed", "1"))
        
        # ! [combolimit]
        return order
    

    """ <summary>
    #/ Create combination orders that include options, stock and futures legs (stock legs can be included if the order is routed 
    #/ through SmartRouting). Although a combination/spread order is constructed of separate legs, it is executed as a single transaction 
    #/ if it is routed directly to an exchange. For combination orders that are SmartRouted, each leg may be executed separately to ensure 
    #/ best execution.
    #/ Products: OPT, STK, FUT
    </summary>"""
    @staticmethod
    def ComboMarketOrder(action:str, quantity:Decimal, nonGuaranteed:bool):
    
        # ! [combomarket]
        order = Order()
        order.action = action
        order.orderType = "MKT"
        order.totalQuantity = quantity
        if nonGuaranteed:
        
            order.smartComboRoutingParams = []
            order.smartComboRoutingParams.append(TagValue("NonGuaranteed", "1"))
        
        # ! [combomarket]
        return order
    

    """ <summary>
    #/ Create combination orders that include options, stock and futures legs (stock legs can be included if the order is routed 
    #/ through SmartRouting). Although a combination/spread order is constructed of separate legs, it is executed as a single transaction 
    #/ if it is routed directly to an exchange. For combination orders that are SmartRouted, each leg may be executed separately to ensure 
    #/ best execution.
    #/ Products: OPT, STK, FUT
    </summary>"""
    @staticmethod
    def LimitOrderForComboWithLegPrices(action:str, quantity:Decimal,
                                        legPrices:list, nonGuaranteed:bool):
    
        # ! [limitordercombolegprices]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.orderComboLegs = []
        for price in legPrices:
        
            comboLeg = OrderComboLeg()
            comboLeg.price = price
            order.orderComboLegs.append(comboLeg)
                   
        if nonGuaranteed:
            order.smartComboRoutingParams = []
            order.smartComboRoutingParams.append(TagValue("NonGuaranteed", "1"))
        
        # ! [limitordercombolegprices]
        return order
    

    """ <summary>
    #/ Create combination orders that include options, stock and futures legs (stock legs can be included if the order is routed 
    #/ through SmartRouting). Although a combination/spread order is constructed of separate legs, it is executed as a single transaction 
    #/ if it is routed directly to an exchange. For combination orders that are SmartRouted, each leg may be executed separately to ensure 
    #/ best execution.
    #/ Products: OPT, STK, FUT
    </summary>"""
    @staticmethod
    def RelativeLimitCombo(action:str, quantity:Decimal, limitPrice:float, 
                           nonGuaranteed:bool):
    
        # ! [relativelimitcombo]
        order = Order()
        order.action = action
        order.totalQuantity = quantity
        order.orderType = "REL + LMT"
        order.lmtPrice = limitPrice
        if nonGuaranteed:
        
            order.smartComboRoutingParams = []
            order.smartComboRoutingParams.append(TagValue("NonGuaranteed", "1"))
        
        # ! [relativelimitcombo]
        return order
    

    """ <summary>
    #/ Create combination orders that include options, stock and futures legs (stock legs can be included if the order is routed 
    #/ through SmartRouting). Although a combination/spread order is constructed of separate legs, it is executed as a single transaction 
    #/ if it is routed directly to an exchange. For combination orders that are SmartRouted, each leg may be executed separately to ensure 
    #/ best execution.
    #/ Products: OPT, STK, FUT
    </summary>"""
    @staticmethod
    def RelativeMarketCombo(action:str, quantity:Decimal, nonGuaranteed:bool):
    
        # ! [relativemarketcombo]
        order = Order()
        order.action = action
        order.totalQuantity = quantity
        order.orderType = "REL + MKT"
        if nonGuaranteed:
        
            order.smartComboRoutingParams = []
            order.smartComboRoutingParams.append(TagValue("NonGuaranteed", "1"))
        
        # ! [relativemarketcombo]
        return order
    

    """ <summary>
    #/ One-Cancels All (OCA) order type allows an investor to place multiple and possibly unrelated orders assigned to a group. The aim is 
    #/ to complete just one of the orders, which in turn will cause TWS to cancel the remaining orders. The investor may submit several 
    #/ orders aimed at taking advantage of the most desirable price within the group. Completion of one piece of the group order causes 
    #/ cancellation of the remaining group orders while partial completion causes the group to rebalance. An investor might desire to sell 
    #/ 1000 shares of only ONE of three positions held above prevailing market prices. The OCA order group allows the investor to enter prices 
    #/ at specified target levels and if one is completed, the other two will automatically cancel. Alternatively, an investor may wish to take 
    #/ a LONG position in eMini S&P stock index futures in a falling market or else SELL US treasury futures at a more favorable price. 
    #/ Grouping the two orders using an OCA order type offers the investor two chance to enter a similar position, while only running the risk 
    #/ of taking on a single position.
    #/ Products: BOND, CASH, FUT, FOP, STK, OPT, WAR
    </summary>"""
    # ! [oca]
    @staticmethod
    def OneCancelsAll(ocaGroup:str, ocaOrders:ListOfOrder, ocaType:int):
    
        for o in ocaOrders:
        
            o.ocaGroup = ocaGroup
            o.ocaType = ocaType
        
        return ocaOrders
    
    # ! [oca]

    """ <summary>
    #/ Specific to US options, investors are able to create and enter Volatility-type orders for options and combinations rather than price orders. 
    #/ Option traders may wish to trade and position for movements in the price of the option determined by its implied volatility. Because 
    #/ implied volatility is a key determinant of the premium on an option, traders position in specific contract months in an effort to take 
    #/ advantage of perceived changes in implied volatility arising before, during or after earnings or when company specific or broad market 
    #/ volatility is predicted to change. In order to create a Volatility order, clients must first create a Volatility Trader page from the 
    #/ Trading Tools menu and as they enter option contracts, premiums will display in percentage terms rather than premium. The buy/sell process 
    #/ is the same as for regular orders priced in premium terms except that the client can limit the volatility level they are willing to pay or 
    #/ receive.
    #/ Products: FOP, OPT
    </summary>"""
    @staticmethod
    def Volatility(action:str, quantity:Decimal, volatilityPercent:float, 
                   volatilityType:int):
    
        # ! [volatility]
        order = Order()
        order.action = action
        order.orderType = "VOL"
        order.totalQuantity = quantity
        order.volatility = volatilityPercent#Expressed in percentage (40%)
        order.volatilityType = volatilityType# 1=daily, 2=annual
        # ! [volatility]
        return order
    

    #! [fhedge]
    @staticmethod
    def MarketFHedge(parentOrderId:int, action:str):
    
        #FX Hedge orders can only have a quantity of 0
        order = OrderSamples.MarketOrder(action, 0)
        order.parentId = parentOrderId
        order.hedgeType = "F"
        return order
    
    #! [fhedge]

    @staticmethod
    def PeggedToBenchmark(action:str, quantity:Decimal, startingPrice:float, 
                           peggedChangeAmountDecrease:bool, 
                           peggedChangeAmount:float,
                           referenceChangeAmount:float, referenceConId:int, 
                           referenceExchange:str, stockReferencePrice:float,  
                           referenceContractLowerRange:float, 
                           referenceContractUpperRange:float):
    
        #! [pegged_benchmark]
        order = Order()
        order.orderType = "PEG BENCH"
        #BUY or SELL
        order.action = action
        order.totalQuantity = quantity
        #Beginning with price...
        order.startingPrice = startingPrice
        #increase/decrease price..
        order.isPeggedChangeAmountDecrease = peggedChangeAmountDecrease
        #by... (and likewise for price moving in opposite direction)
        order.peggedChangeAmount = peggedChangeAmount
        #whenever there is a price change of...
        order.referenceChangeAmount = referenceChangeAmount
        #in the reference contract...
        order.referenceContractId = referenceConId
        #being traded at...
        order.referenceExchange = referenceExchange
        #starting reference price is...
        order.stockRefPrice = stockReferencePrice
        #Keep order active as long as reference contract trades between...
        order.stockRangeLower = referenceContractLowerRange
        #and...
        order.stockRangeUpper = referenceContractUpperRange
        #! [pegged_benchmark]
        return order
    
    

    @staticmethod
    def AttachAdjustableToStop(parent:Order , attachedOrderStopPrice:float, 
                               triggerPrice:float, adjustStopPrice:float):
    
        #! [adjustable_stop]
        # Attached order is a conventional STP order in opposite direction
        order = OrderSamples.Stop("SELL" if parent.action == "BUY" else "BUY",
                     parent.totalQuantity, attachedOrderStopPrice)
        order.parentId = parent.orderId
        #When trigger price is penetrated
        order.triggerPrice = triggerPrice
        #The parent order will be turned into a STP order
        order.adjustedOrderType = "STP"
        #With the given STP price
        order.adjustedStopPrice = adjustStopPrice
        #! [adjustable_stop]
        return order
    

    @staticmethod
    def AttachAdjustableToStopLimit(parent:Order, attachedOrderStopPrice:float, 
                                    triggerPrice:float, adjustedStopPrice:float, 
                                    adjustedStopLimitPrice:float):
    
        #! [adjustable_stop_limit]
        #Attached order is a conventional STP order
        order = OrderSamples.Stop("SELL" if parent.action == "BUY" else "BUY",
                                  parent.totalQuantity, attachedOrderStopPrice)
        order.parentId = parent.orderId
        #When trigger price is penetrated
        order.triggerPrice = triggerPrice
        #The parent order will be turned into a STP LMT order
        order.adjustedOrderType = "STP LMT"
        #With the given stop price
        order.adjustedStopPrice = adjustedStopPrice
        #And the given limit price
        order.adjustedStopLimitPrice = adjustedStopLimitPrice
        #! [adjustable_stop_limit]
        return order


    @staticmethod
    def  AttachAdjustableToTrail(parent:Order, attachedOrderStopPrice:float, 
                                 triggerPrice:float, adjustedStopPrice:float, 
                                 adjustedTrailAmount:float, trailUnit:int):
        #! [adjustable_trail]
        #Attached order is a conventional STP order
        order = OrderSamples.Stop("SELL" if parent.action == "BUY" else "BUY",
                     parent.totalQuantity, attachedOrderStopPrice)
        order.parentId = parent.orderId
        #When trigger price is penetrated
        order.triggerPrice = triggerPrice
        #The parent order will be turned into a TRAIL order
        order.adjustedOrderType = "TRAIL"
        #With a stop price of...
        order.adjustedStopPrice = adjustedStopPrice
        #trailing by and amount (0) or a percent (100)...
        order.adjustableTrailingUnit = trailUnit
        #of...
        order.adjustedTrailingAmount = adjustedTrailAmount
        #! [adjustable_trail]        
        return order
 

    @staticmethod
    def PriceCondition(triggerMethod:int, conId:int, exchange:str, price:float, 
                        isMore:bool, isConjunction:bool):
    
        #! [price_condition]
        #Conditions have to be created via the OrderCondition.create 
        priceCondition = order_condition.Create(OrderCondition.Price)
        #When this contract...
        priceCondition.conId = conId
        #traded on this exchange
        priceCondition.exchange = exchange
        #has a price above/below
        priceCondition.isMore = isMore
        priceCondition.triggerMethod = triggerMethod
        #this quantity
        priceCondition.price = price
        #AND | OR next condition (will be ignored if no more conditions are added)
        priceCondition.isConjunctionConnection = isConjunction
        #! [price_condition]
        return priceCondition
    

    @staticmethod
    def ExecutionCondition(symbol:str, secType:str, exchange:str, 
                           isConjunction:bool):
    
        #! [execution_condition]
        execCondition = order_condition.Create(OrderCondition.Execution)
        #When an execution on symbol
        execCondition.symbol = symbol
        #at exchange
        execCondition.exchange = exchange
        #for this secType
        execCondition.secType = secType
        #AND | OR next condition (will be ignored if no more conditions are added)
        execCondition.isConjunctionConnection = isConjunction
        #! [execution_condition]
        return execCondition
    

    @staticmethod
    def MarginCondition(percent:int, isMore:bool, isConjunction:bool):
    
        #! [margin_condition]
        marginCondition = order_condition.Create(OrderCondition.Margin)
        #If margin is above/below
        marginCondition.isMore = isMore
        #given percent
        marginCondition.percent = percent
        #AND | OR next condition (will be ignored if no more conditions are added)
        marginCondition.isConjunctionConnection = isConjunction
        #! [margin_condition]
        return marginCondition
    

    @staticmethod
    def PercentageChangeCondition(pctChange:float, conId:int, exchange:str, 
                                  isMore:bool, isConjunction:bool):
    
        #! [percentage_condition]
        pctChangeCondition = order_condition.Create(OrderCondition.PercentChange)
        #If there is a price percent change measured against last close price above or below...
        pctChangeCondition.isMore = isMore
        #this amount...
        pctChangeCondition.changePercent = pctChange
        #on this contract
        pctChangeCondition.conId = conId
        #when traded on this exchange...
        pctChangeCondition.exchange = exchange
        #AND | OR next condition (will be ignored if no more conditions are added)
        pctChangeCondition.isConjunctionConnection = isConjunction
        #! [percentage_condition]
        return pctChangeCondition
    

    @staticmethod
    def TimeCondition(time:str, isMore:bool, isConjunction:bool):
    
        #! [time_condition]
        timeCondition = order_condition.Create(OrderCondition.Time)
        #Before or after...
        timeCondition.isMore = isMore
        #this time..
        timeCondition.time = time
        #AND | OR next condition (will be ignored if no more conditions are added)     
        timeCondition.isConjunctionConnection = isConjunction
        #! [time_condition]
        return timeCondition
    

    @staticmethod
    def VolumeCondition(conId:int, exchange:str, isMore:bool, volume:int, 
                        isConjunction:bool):
    
        #! [volume_condition]
        volCond = order_condition.Create(OrderCondition.Volume)
        #Whenever contract...
        volCond.conId = conId
        #When traded at
        volCond.exchange = exchange
        #reaches a volume higher/lower
        volCond.isMore = isMore
        #than this...
        volCond.volume = volume
        #AND | OR next condition (will be ignored if no more conditions are added)
        volCond.isConjunctionConnection = isConjunction
        #! [volume_condition]
        return volCond
        
    @staticmethod
    def LimitIBKRATS(action:str, quantity:Decimal, limitPrice:float):
    
        # ! [limit_ibkrats]
        order = Order()
        order.action = action
        order.orderType = "LMT"
        order.lmtPrice = limitPrice
        order.totalQuantity = quantity
        order.notHeld = True
        # ! [limit_ibkrats]
        return order

    @staticmethod
    def LimitOrderWithManualOrderTime(action:str, quantity:Decimal, limitPrice:float, manualOrderTime:str):

        # ! [limit_order_with_manual_order_time]
        order = OrderSamples.LimitOrder(action, quantity, limitPrice)
        order.manualOrderTime = manualOrderTime
        # ! [limit_order_with_manual_order_time]
        return order

    @staticmethod
    def PegBestUpToMidOrder(action:str, quantity:Decimal, limitPrice:float, minTradeQty:int, minCompeteSize:int, midOffsetAtWhole:float, midOffsetAtHalf:float):

        # ! [peg_best_up_to_mid_order]
        order = Order()
        order.action = action
        order.orderType = "PEG BEST"
        order.lmtPrice = limitPrice
        order.totalQuantity = quantity
        order.notHeld = True
        order.minTradeQty = minTradeQty
        order.minCompeteSize = minCompeteSize
        order.competeAgainstBestOffset = COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID
        order.midOffsetAtWhole = midOffsetAtWhole
        order.midOffsetAtHalf = midOffsetAtHalf
        # ! [peg_best_up_to_mid_order]
        return order

    @staticmethod
    def PegBestOrder(action:str, quantity:Decimal, limitPrice:float, minTradeQty:int, minCompeteSize:int, competeAgainstBestOffset:float):

        # ! [peg_best_order]
        order = Order()
        order.action = action
        order.orderType = "PEG BEST"
        order.lmtPrice = limitPrice
        order.totalQuantity = quantity
        order.notHeld = True
        order.minTradeQty = minTradeQty
        order.minCompeteSize = minCompeteSize
        order.competeAgainstBestOffset = competeAgainstBestOffset
        # ! [peg_best_order]
        return order

    @staticmethod
    def PegMidOrder(action:str, quantity:Decimal, limitPrice:float, minTradeQty:int, midOffsetAtWhole:float, midOffsetAtHalf:float):

        # ! [peg_mid_order]
        order = Order()
        order.action = action
        order.orderType = "PEG MID"
        order.lmtPrice = limitPrice
        order.totalQuantity = quantity
        order.notHeld = True
        order.minTradeQty = minTradeQty
        order.midOffsetAtWhole = midOffsetAtWhole
        order.midOffsetAtHalf = midOffsetAtHalf
        # ! [peg_mid_order]
        return order

    @staticmethod
    def LimitOrderWithCustomerAccount(action:str, quantity:Decimal, limitPrice:float, customerAccount:str):

        # ! [limit_order_with_customer_account]
        order = OrderSamples.LimitOrder(action, quantity, limitPrice)
        order.customerAccount = customerAccount
        # ! [limit_order_with_customer_account]
        return order

    @staticmethod
    def LimitOrderWithIncludeOvernight(action:str, quantity:Decimal, limitPrice:float):

        # ! [limit_order_with_include_overnight]
        order = OrderSamples.LimitOrder(action, quantity, limitPrice)
        order.includeOvernight = True
        # ! [limit_order_with_include_overnight]
        return order

    @staticmethod
    def CancelOrderEmpty():
        # ! [cancel_order_empty]
        orderCancel = OrderCancel()
        # ! [cancel_order_empty]
        return orderCancel

    @staticmethod
    def CancelOrderWithManualTime(manualOrderCancelTime: str):
        # ! [cancel_order_with_manual_time]
        orderCancel = OrderCancel()
        orderCancel.manualOrderCancelTime = manualOrderCancelTime
        # ! [cancel_order_with_manual_time]
        return orderCancel

    @staticmethod
    def LimitOrderWithCmeTaggingFields(action: str, quantity: Decimal, limitPrice: float, extOperator: str, manualOrderIndicator: int):
        # ! [limit_order_with_cme_tagging_fields]
        order = OrderSamples.LimitOrder(action, quantity, limitPrice)
        order.extOperator = extOperator
        order.manualOrderIndicator = manualOrderIndicator
        # ! [limit_order_with_cme_tagging_fields]
        return order

    @staticmethod
    def OrderCancelWithCmeTaggingFields(extOperator: str, manualOrderIndicator: int):
        # ! [order_cancel_with_cme_tagging_fields]
        orderCancel = OrderCancel()
        orderCancel.extOperator = extOperator
        orderCancel.manualOrderIndicator = manualOrderIndicator
        # ! [order_cancel_with_cme_tagging_fields]
        return orderCancel
    
    @staticmethod
    def LimitOnCloseOrderWithImbalanceOnly(action:str, quantity:Decimal, limitPrice:float):
        # ! [limit_on_close_order_with_imbalance_only]
        order = Order()
        order.action = action
        order.orderType = "LOC"
        order.totalQuantity = quantity
        order.lmtPrice = limitPrice
        order.imbalanceOnly = True
        # ! [limit_on_close_order_with_imbalance_only]
        return order

    @staticmethod
    def LimitOrderWithStopLossAndProfitTaker(action:str, quantity:Decimal, limitPrice:float, slOrderId:int, ptOrderId:int):
        # ! [limit_order_with_stop_loss_and_protif_taker]
        order = OrderSamples.LimitOrder(action, quantity, limitPrice)
        order.slOrderId = slOrderId
        order.slOrderType = "PRESET"
        order.ptOrderId = ptOrderId
        order.ptOrderType = "PRESET"
        # ! [limit_order_with_stop_loss_and_protif_taker]
        return order;

def Test():
    os = OrderSamples() # @UnusedVariable

if "__main__" == __name__:
    Test()
       
