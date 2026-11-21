import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "users", "line_user_id", existing_type=sa.Text(), nullable=True, schema="saiflow_v3"
    )


def downgrade():
    connection = op.get_bind()
    if connection.execute(
        sa.text("select 1 from saiflow_v3.users where line_user_id is null limit 1")
    ).first():
        raise RuntimeError("Cannot restore required LINE identity while email-only users exist")
    op.alter_column(
        "users", "line_user_id", existing_type=sa.Text(), nullable=False, schema="saiflow_v3"
    )
