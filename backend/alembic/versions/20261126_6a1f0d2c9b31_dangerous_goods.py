"""dangerous goods: item / order line DG data, approval refs, plan rule set

Revision ID: 6a1f0d2c9b31
Revises: 232201272094
Create Date: 2026-11-26 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401
from sqlalchemy.dialects import postgresql

revision: str = '6a1f0d2c9b31'
down_revision: Union[str, Sequence[str], None] = '232201272094'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

rule_set = postgresql.ENUM('adg', 'northline', name='rule_set', create_type=False)


def upgrade() -> None:
    op.add_column('items', sa.Column('dg', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('order_lines', sa.Column('dg', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('order_lines', sa.Column(
        'dg_approval_ref', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True))
    postgresql.ENUM('adg', 'northline', name='rule_set').create(op.get_bind(), checkfirst=True)
    op.add_column('plans', sa.Column('rule_set', rule_set, server_default='adg', nullable=False))


def downgrade() -> None:
    op.drop_column('plans', 'rule_set')
    op.execute("DROP TYPE IF EXISTS rule_set")
    op.drop_column('order_lines', 'dg_approval_ref')
    op.drop_column('order_lines', 'dg')
    op.drop_column('items', 'dg')
