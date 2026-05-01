"""
Copyright (C) 2019 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

import unittest

from ibapi.order_condition import *


class ConditionOrderTestCase(unittest.TestCase):
    conds = [
        VolumeCondition(8314, "SMART", True, 1000000).And(),
        PercentChangeCondition(1111, "AMEX", True, 0.25).Or(),
        PriceCondition(
            PriceCondition.TriggerMethodEnum.DoubleLast, 2222, "NASDAQ", False, 4.75
        ).And(),
        TimeCondition(True, "20170101 09:30:00").And(),
        MarginCondition(False, 200000).Or(),
        ExecutionCondition("STK", "SMART", "AMD"),
    ]

    for cond in conds:
        print(cond, OrderCondition.__str__(cond))


if "__main__" == __name__:
    unittest.main()
