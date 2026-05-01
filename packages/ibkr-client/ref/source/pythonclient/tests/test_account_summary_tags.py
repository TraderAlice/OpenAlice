"""
Copyright (C) 2019 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

import unittest
from ibapi.account_summary_tags import AccountSummaryTags


class AccountSummaryTagsTestCase(unittest.TestCase):
    def setUp(self):
        pass

    def tearDown(self):
        pass

    def test_all_tags(self):
        print(AccountSummaryTags.AllTags)


if "__main__" == __name__:
    unittest.main()
