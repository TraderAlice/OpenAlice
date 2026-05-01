"""
Copyright (C) 2019 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

from ibapi.object_implem import Object
from ibapi.tag_value import TagValue
from ibapi.order import Order


class AvailableAlgoParams(Object):

    # ! [scale_params]
    @staticmethod
    def FillScaleParams(baseOrder: Order, scaleInitLevelSize: int, scaleSubsLevelSize: int, scaleRandomPercent: bool,
                        scalePriceIncrement: float, scalePriceAdjustValue: float, scalePriceAdjustInterval: int,
                        scaleProfitOffset: float, scaleAutoReset: bool, scaleInitPosition: int, scaleInitFillQty: int):
        baseOrder.scaleInitLevelSize = scaleInitLevelSize # Initial Component Size
        baseOrder.scaleSubsLevelSize = scaleSubsLevelSize # Subsequent Comp. Size
        baseOrder.scaleRandomPercent = scaleRandomPercent # Randomize size by +/-55%
        baseOrder.scalePriceIncrement = scalePriceIncrement # Price Increment

        # Auto Price adjustment
        baseOrder.scalePriceAdjustValue = scalePriceAdjustValue # starting price by
        baseOrder.scalePriceAdjustInterval = scalePriceAdjustInterval # in seconds

        # Profit Orders
        baseOrder.scaleProfitOffset = scaleProfitOffset # Create profit taking order Profit Offset
        baseOrder.scaleAutoReset = scaleAutoReset # Restore size after taking profit
        baseOrder.scaleInitPosition = scaleInitPosition # Initial Position
        baseOrder.scaleInitFillQty = scaleInitFillQty # Filled initial Component Size
    # ! [scale_params]

    # ! [arrivalpx_params]
    @staticmethod
    def FillArrivalPriceParams(baseOrder: Order, maxPctVol: float,
                               riskAversion: str, startTime: str, endTime: str,
                               forceCompletion: bool, allowPastTime: bool):
        baseOrder.algoStrategy = "ArrivalPx"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("maxPctVol", maxPctVol))
        baseOrder.algoParams.append(TagValue("riskAversion", riskAversion))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("forceCompletion",
                                             int(forceCompletion)))
        baseOrder.algoParams.append(TagValue("allowPastEndTime",
                                             int(allowPastTime)))


    # ! [arrivalpx_params]


    # ! [darkice_params]
    @staticmethod
    def FillDarkIceParams(baseOrder: Order, displaySize: int, startTime: str,
                          endTime: str, allowPastEndTime: bool):
        baseOrder.algoStrategy = "DarkIce"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("displaySize", displaySize))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("allowPastEndTime",
                                             int(allowPastEndTime)))


    # ! [darkice_params]


    # ! [pctvol_params]
    @staticmethod
    def FillPctVolParams(baseOrder: Order, pctVol: float, startTime: str,
                         endTime: str, noTakeLiq: bool):
        baseOrder.algoStrategy = "PctVol"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("pctVol", pctVol))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("noTakeLiq", int(noTakeLiq)))


    # ! [pctvol_params]


    # ! [twap_params]
    @staticmethod
    def FillTwapParams(baseOrder: Order, strategyType: str, startTime: str,
                       endTime: str, allowPastEndTime: bool):
        baseOrder.algoStrategy = "Twap"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("strategyType", strategyType))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("allowPastEndTime",
                                             int(allowPastEndTime)))

    # ! [twap_params]


    # ! [vwap_params]
    @staticmethod
    def FillVwapParams(baseOrder: Order, maxPctVol: float, startTime: str,
                       endTime: str, allowPastEndTime: bool, noTakeLiq: bool):
        baseOrder.algoStrategy = "Vwap"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("maxPctVol", maxPctVol))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("allowPastEndTime",
                                             int(allowPastEndTime)))
        baseOrder.algoParams.append(TagValue("noTakeLiq", int(noTakeLiq)))


    # ! [vwap_params]


    # ! [ad_params]
    @staticmethod
    def FillAccumulateDistributeParams(baseOrder: Order, componentSize: int,
                                       timeBetweenOrders: int, randomizeTime20: bool, randomizeSize55: bool,
                                       giveUp: int, catchUp: bool, waitForFill: bool, startTime: str,
                                       endTime: str):
        baseOrder.algoStrategy = "AD"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("componentSize", componentSize))
        baseOrder.algoParams.append(TagValue("timeBetweenOrders", timeBetweenOrders))
        baseOrder.algoParams.append(TagValue("randomizeTime20",
                                             int(randomizeTime20)))
        baseOrder.algoParams.append(TagValue("randomizeSize55",
                                             int(randomizeSize55)))
        baseOrder.algoParams.append(TagValue("giveUp", giveUp))
        baseOrder.algoParams.append(TagValue("catchUp", int(catchUp)))
        baseOrder.algoParams.append(TagValue("waitForFill", int(waitForFill)))
        baseOrder.algoParams.append(TagValue("activeTimeStart", startTime))
        baseOrder.algoParams.append(TagValue("activeTimeEnd", endTime))

    # ! [ad_params]


    # ! [balanceimpactrisk_params]
    @staticmethod
    def FillBalanceImpactRiskParams(baseOrder: Order, maxPctVol: float,
                                    riskAversion: str, forceCompletion: bool):
        baseOrder.algoStrategy = "BalanceImpactRisk"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("maxPctVol", maxPctVol))
        baseOrder.algoParams.append(TagValue("riskAversion", riskAversion))
        baseOrder.algoParams.append(TagValue("forceCompletion",
                                             int(forceCompletion)))

    # ! [balanceimpactrisk_params]


    # ! [minimpact_params]
    @staticmethod
    def FillMinImpactParams(baseOrder: Order, maxPctVol: float):
        baseOrder.algoStrategy = "MinImpact"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("maxPctVol", maxPctVol))

    # ! [minimpact_params]


    # ! [adaptive_params]
    @staticmethod
    def FillAdaptiveParams(baseOrder: Order, priority: str):
        baseOrder.algoStrategy = "Adaptive"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("adaptivePriority", priority))

    # ! [adaptive_params]

    # ! [closepx_params]
    @staticmethod
    def FillClosePriceParams(baseOrder: Order, maxPctVol: float, riskAversion: str,
                             startTime: str, forceCompletion: bool):
        baseOrder.algoStrategy = "ClosePx"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("maxPctVol", maxPctVol))
        baseOrder.algoParams.append(TagValue("riskAversion", riskAversion))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("forceCompletion", int(forceCompletion)))


    # ! [closepx_params]


    # ! [pctvolpx_params]
    @staticmethod
    def FillPriceVariantPctVolParams(baseOrder: Order, pctVol: float,
                                     deltaPctVol: float, minPctVol4Px: float,
                                     maxPctVol4Px: float, startTime: str,
                                     endTime: str, noTakeLiq: bool):
        baseOrder.algoStrategy = "PctVolPx"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("pctVol", pctVol))
        baseOrder.algoParams.append(TagValue("deltaPctVol", deltaPctVol))
        baseOrder.algoParams.append(TagValue("minPctVol4Px", minPctVol4Px))
        baseOrder.algoParams.append(TagValue("maxPctVol4Px", maxPctVol4Px))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("noTakeLiq", int(noTakeLiq)))


    # ! [pctvolpx_params]


    # ! [pctvolsz_params]
    @staticmethod
    def FillSizeVariantPctVolParams(baseOrder: Order, startPctVol: float,
                                    endPctVol: float, startTime: str,
                                    endTime: str, noTakeLiq: bool):
        baseOrder.algoStrategy = "PctVolSz"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("startPctVol", startPctVol))
        baseOrder.algoParams.append(TagValue("endPctVol", endPctVol))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("noTakeLiq", int(noTakeLiq)))


    # ! [pctvolsz_params]


    # ! [pctvoltm_params]
    @staticmethod
    def FillTimeVariantPctVolParams(baseOrder: Order, startPctVol: float,
                                    endPctVol: float, startTime: str,
                                    endTime: str, noTakeLiq: bool):
        baseOrder.algoStrategy = "PctVolTm"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("startPctVol", startPctVol))
        baseOrder.algoParams.append(TagValue("endPctVol", endPctVol))
        baseOrder.algoParams.append(TagValue("startTime", startTime))
        baseOrder.algoParams.append(TagValue("endTime", endTime))
        baseOrder.algoParams.append(TagValue("noTakeLiq", int(noTakeLiq)))

    # ! [pctvoltm_params]

    # ! [jefferies_vwap_params]
    @staticmethod
    def FillJefferiesVWAPParams(baseOrder: Order, startTime: str,
                                endTime: str, relativeLimit: float,
                                maxVolumeRate: float, excludeAuctions: str,
                                triggerPrice: float, wowPrice: float,
                                minFillSize: int, wowOrderPct: float,
                                wowMode: str, isBuyBack: bool, wowReference: str):
        # must be direct-routed to "JEFFALGO"
        baseOrder.algoStrategy = "VWAP"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("StartTime", startTime))
        baseOrder.algoParams.append(TagValue("EndTime", endTime))
        baseOrder.algoParams.append(TagValue("RelativeLimit", relativeLimit))
        baseOrder.algoParams.append(TagValue("MaxVolumeRate", maxVolumeRate))
        baseOrder.algoParams.append(TagValue("ExcludeAuctions", excludeAuctions))
        baseOrder.algoParams.append(TagValue("TriggerPrice", triggerPrice))
        baseOrder.algoParams.append(TagValue("WowPrice", wowPrice))
        baseOrder.algoParams.append(TagValue("MinFillSize", minFillSize))
        baseOrder.algoParams.append(TagValue("WowOrderPct", wowOrderPct))
        baseOrder.algoParams.append(TagValue("WowMode", wowMode))
        baseOrder.algoParams.append(TagValue("IsBuyBack", int(isBuyBack)))
        baseOrder.algoParams.append(TagValue("WowReference", wowReference))
    # ! [jefferies_vwap_params]

    # ! [csfb_inline_params]
    @staticmethod
    def FillCSFBInlineParams(baseOrder: Order, startTime: str,
                             endTime: str, execStyle: str,
                             minPercent: int, maxPercent: int,
                             displaySize: int, auction: str,
                             blockFinder: bool, blockPrice: float,
                             minBlockSize: int, maxBlockSize: int, iWouldPrice: float):
        # must be direct-routed to "CSFBALGO"
        baseOrder.algoStrategy = "INLINE"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("StartTime", startTime))
        baseOrder.algoParams.append(TagValue("EndTime", endTime))
        baseOrder.algoParams.append(TagValue("ExecStyle", execStyle))
        baseOrder.algoParams.append(TagValue("MinPercent", minPercent))
        baseOrder.algoParams.append(TagValue("MaxPercent", maxPercent))
        baseOrder.algoParams.append(TagValue("DisplaySize", displaySize))
        baseOrder.algoParams.append(TagValue("Auction", auction))
        baseOrder.algoParams.append(TagValue("BlockFinder", int(blockFinder)))
        baseOrder.algoParams.append(TagValue("BlockPrice", blockPrice))
        baseOrder.algoParams.append(TagValue("MinBlockSize", minBlockSize))
        baseOrder.algoParams.append(TagValue("MaxBlockSize", maxBlockSize))
        baseOrder.algoParams.append(TagValue("IWouldPrice", iWouldPrice))
    # ! [csfb_inline_params]

    # ! [qbalgo_strobe_params]
    @staticmethod
    def FillQBAlgoInLineParams(baseOrder: Order, startTime: str, 
                               endTime: str, duration: float, 
                               benchmark: str, percentVolume: float, 
                               noCleanUp: bool):
        # must be direct-routed to "QBALGO"
        baseOrder.algoStrategy = "STROBE"
        baseOrder.algoParams = []
        baseOrder.algoParams.append(TagValue("StartTime", startTime))
        baseOrder.algoParams.append(TagValue("EndTime", endTime))
        #This example uses endTime instead of duration
        #baseOrder.algoParams.append(TagValue("Duration", str(duration)))
        baseOrder.algoParams.append(TagValue("Benchmark", benchmark)) 
        baseOrder.algoParams.append(TagValue("PercentVolume", str(percentVolume)))
        baseOrder.algoParams.append(TagValue("NoCleanUp", int(noCleanUp)))
    # ! [qbalgo_strobe_params]


def Test():
    av = AvailableAlgoParams() # @UnusedVariable


if "__main__" == __name__:
    Test()
