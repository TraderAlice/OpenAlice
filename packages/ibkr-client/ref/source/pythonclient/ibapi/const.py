import math
import sys
from _decimal import Decimal

NO_VALID_ID = -1
MAX_MSG_LEN = 0xFFFFFF  # 16Mb - 1byte
UNSET_INTEGER = 2**31 - 1
UNSET_DOUBLE = float(sys.float_info.max)
UNSET_LONG = 2**63 - 1
UNSET_DECIMAL = Decimal(2**127 - 1)
DOUBLE_INFINITY = math.inf
INFINITY_STR = "Infinity"
