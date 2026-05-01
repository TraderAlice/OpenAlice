"""
Copyright (C) 2019 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

import unittest

from ibapi.enum_implem import Enum


class EnumTestCase(unittest.TestCase):
    def setUp(self):
        pass

    def tearDown(self):
        pass

    def test_enum(self):
        e = Enum("ZERO", "ONE", "TWO")
        print(e.ZERO)
        print(e.toStr(e.ZERO))


if "__main__" == __name__:
    unittest.main()
