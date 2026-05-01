"""
Copyright (C) 2024 Interactive Brokers LLC. All rights reserved. This code is subject to the terms
 and conditions of the IB API Non-Commercial License or the IB API Commercial License, as applicable.
"""

"""
Simple class for ineligibility reason 
"""

from ibapi.object_implem import Object

class IneligibilityReason(Object):
    def __init__(self, id_: str = None, description: str = None):
        self.id_ = str(id_)
        self.description = str(description)

    def __str__(self):
        return f"[id: {self.id_}, description: {self.description}];"
