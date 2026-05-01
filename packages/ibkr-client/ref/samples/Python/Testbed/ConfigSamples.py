"""
Copyright (C) 2026 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

from ibapi.protobuf.UpdateConfigRequest_pb2 import UpdateConfigRequest as UpdateConfigRequestProto
from ibapi.protobuf.ApiConfig_pb2 import ApiConfig as ApiConfigProto
from ibapi.protobuf.ApiSettingsConfig_pb2 import ApiSettingsConfig as ApiSettingsConfigProto
from ibapi.protobuf.OrdersConfig_pb2 import OrdersConfig as OrdersConfigProto
from ibapi.protobuf.OrdersSmartRoutingConfig_pb2 import OrdersSmartRoutingConfig as OrdersSmartRoutingConfigProto
from ibapi.protobuf.MessageConfig_pb2 import MessageConfig as MessageConfigProto
from ibapi.protobuf.UpdateConfigWarning_pb2 import UpdateConfigWarning as UpdateConfigWarningProto

class ConfigSamples:

    @staticmethod
    def UpdateConfigApiSettings(reqId: int) -> UpdateConfigRequestProto:
        #! [UpdateApiSettingsConfig]
        updateConfigRequestProto = UpdateConfigRequestProto()
        apiConfigProto = ApiConfigProto()
        apiSettingsConfigProto = ApiSettingsConfigProto()
        apiSettingsConfigProto.totalQuantityForMutualFunds = True
        apiSettingsConfigProto.downloadOpenOrdersOnConnection = True
        apiSettingsConfigProto.includeVirtualFxPositions = True
        apiSettingsConfigProto.prepareDailyPnL = True
        apiSettingsConfigProto.sendStatusUpdatesForVolatilityOrders = True
        apiSettingsConfigProto.encodeApiMessages = "osCodePage"
        apiSettingsConfigProto.socketPort = 7497
        apiSettingsConfigProto.useNegativeAutoRange = True
        apiSettingsConfigProto.createApiMessageLogFile = True
        apiSettingsConfigProto.includeMarketDataInLogFile = True
        apiSettingsConfigProto.exposeTradingScheduleToApi = True
        apiSettingsConfigProto.splitInsuredDepositFromCashBalance = True
        apiSettingsConfigProto.sendZeroPositionsForTodayOnly = True
        apiSettingsConfigProto.useAccountGroupsWithAllocationMethods = True
        apiSettingsConfigProto.loggingLevel = "error"
        apiSettingsConfigProto.masterClientId = 3
        apiSettingsConfigProto.bulkDataTimeout = 25
        apiSettingsConfigProto.componentExchSeparator = "#"
        apiSettingsConfigProto.roundAccountValuesToNearestWholeNumber = True
        apiSettingsConfigProto.showAdvancedOrderRejectInUi = True
        apiSettingsConfigProto.rejectMessagesAboveMaxRate = True
        apiSettingsConfigProto.maintainConnectionOnIncorrectFields = True
        apiSettingsConfigProto.compatibilityModeNasdaqStocks = True
        apiSettingsConfigProto.sendInstrumentTimezone = "utc"
        apiSettingsConfigProto.sendForexDataInCompatibilityMode = True
        apiSettingsConfigProto.maintainAndResubmitOrdersOnReconnect = True
        apiSettingsConfigProto.historicalDataMaxSize = 4
        apiSettingsConfigProto.autoReportNettingEventContractTrades = True
        apiSettingsConfigProto.optionExerciseRequestType = "final"
        apiSettingsConfigProto.trustedIPs.append("127.0.0.1")
        
        apiConfigProto.settings.CopyFrom(apiSettingsConfigProto)
        updateConfigRequestProto.reqId = reqId
        updateConfigRequestProto.api.CopyFrom(apiConfigProto)
        #! [UpdateApiSettingsConfig]
        return updateConfigRequestProto

    @staticmethod
    def UpdateOrdersConfig(reqId: int) -> UpdateConfigRequestProto:
        #! [UpdateOrderConfig]
        updateConfigRequestProto = UpdateConfigRequestProto()
        ordersConfigProto = OrdersConfigProto()
        ordersSmartRoutingConfigProto = OrdersSmartRoutingConfigProto()
        ordersSmartRoutingConfigProto.seekPriceImprovement = True
        ordersSmartRoutingConfigProto.doNotRouteToDarkPools = True
        ordersConfigProto.smartRouting.CopyFrom(ordersSmartRoutingConfigProto)
        updateConfigRequestProto.reqId = reqId
        updateConfigRequestProto.orders.CopyFrom(ordersConfigProto)
        #! [UpdateOrderConfig]
        return updateConfigRequestProto

    @staticmethod
    def UpdateMessageConfigConfirmMandatoryCapPriceAccepted(reqId: int) -> UpdateConfigRequestProto:
        #! [UpdateMessageConfigConfirmMandatoryCapPriceAccepted]
        updateConfigRequestProto = UpdateConfigRequestProto()
        messageConfigProto = MessageConfigProto()
        messageConfigProto.id = 131
        messageConfigProto.enabled = False
        updateConfigRequestProto.reqId = reqId
        updateConfigRequestProto.messages.append(messageConfigProto)
        updateConfigWarningProto = UpdateConfigWarningProto()
        updateConfigWarningProto.messageId = 131
        updateConfigRequestProto.acceptedWarnings.append(updateConfigWarningProto)
        #! [UpdateMessageConfigConfirmMandatoryCapPriceAccepted]
        return updateConfigRequestProto

    @staticmethod
    def UpdateConfigOrderIdReset(reqId: int) -> UpdateConfigRequestProto:
        #! [ UpdateConfigOrderIdReset]
        updateConfigRequestProto = UpdateConfigRequestProto()
        updateConfigRequestProto.reqId = reqId
        updateConfigRequestProto.resetAPIOrderSequence = True
        #! [ UpdateConfigOrderIdReset]
        return updateConfigRequestProto


def Test():
    from ibapi.utils import ExerciseStaticMethods
    ExerciseStaticMethods(ConfigSamples)

if "__main__" == __name__:
    Test()
       