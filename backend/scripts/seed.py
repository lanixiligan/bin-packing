"""
Demo data. Owner: Agent A.   Run:  make seed   (cd backend && python -m scripts.seed)

Wipes the database tables and creates (CONTRACT: the README and the e2e test
rely on these logins):

    Customer company "Acme Hardware Pty Ltd"
        alice@acme.example.com      customer
        bob@acme.example.com        customer
    dispatch@freightco.example.com  dispatcher
    driver1@freightco.example.com   driver
    driver2@freightco.example.com   driver
    Password for every seed user:   demo-pass-123

    Zones NORTH, SOUTH, WEST (different rates); ~15 addresses across them
    4 vehicles with different capacity mixes (weight / volume / pallets)
    ~20 items; ~30 orders in mixed statuses with consistent event histories
"""

SEED_PASSWORD = "demo-pass-123"


def main() -> None:
    raise NotImplementedError("Agent A: seed script")


if __name__ == "__main__":
    main()
