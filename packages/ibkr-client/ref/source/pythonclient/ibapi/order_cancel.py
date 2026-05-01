"""
Copyright (C) 2024 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

from ibapi.const import UNSET_INTEGER
from ibapi.object_implem import Object
from ibapi.utils import intMaxString

class OrderCancel(Object):
    def __init__(self):
        self.manualOrderCancelTime = ""
        self.extOperator = ""
        self.manualOrderIndicator = UNSET_INTEGER

    def __str__(self):
        s = "manualOrderCancelTime: %s, extOperator: %s, manualOrderIndicator: %s" % (
            self.manualOrderCancelTime, self.extOperator, intMaxString(self.manualOrderIndicator)
        )

        return s
