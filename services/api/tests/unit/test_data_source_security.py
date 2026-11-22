import ipaddress

import pytest
from pydantic import SecretStr

from app.errors import AppError


@pytest.mark.parametrize(
    "sql",
    [
        "select id, amount from public.orders order by id",
        "with x as (select id from orders) select count(*) as total from x",
        "select sum(amount), date_trunc('month', created_at) from orders group by 2",
        "select coalesce(name, 'pg_sleep(9); delete') from orders",
        "select id from a union all select id from b",
    ],
)
def test_readonly_selects_are_accepted(sql):
    from app.services.data_source_security import readonly_sql

    assert readonly_sql(sql).upper().startswith(("SELECT", "WITH"))


@pytest.mark.parametrize(
    "sql",
    [
        "",
        "select 1; select 2",
        "delete from orders",
        "drop table orders",
        "with x as (delete from orders returning *) select * from x",
        "select * into copied from orders",
        "select * from orders for update",
        "select pg_sleep(1)",
        "select pg_read_file('/etc/passwd')",
        "select pg_catalog.pg_sleep(1)",
        "select public.sum(amount) from orders",
        "select set_config('search_path', 'public', false)",
        "select nextval('s')",
        "select dblink('password=secret', 'select 1')",
        "select 'x'::public.custom_type",
        "copy orders to '/tmp/orders'",
        "select * from orders tablesample system(10)",
        "select 1 as a union select pg_advisory_lock(1)",
        "select * from pg_catalog.pg_authid",
        "select * from information_schema.tables",
        "select * from orders where id = $1",
        "select * from orders; --\n delete from orders",
    ],
)
def test_unsafe_sql_is_rejected(sql):
    from app.services.data_source_security import readonly_sql

    with pytest.raises(AppError) as exc:
        readonly_sql(sql)
    assert exc.value.code == "data_source_sql_invalid"
    assert "secret" not in str(exc.value.details)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.1.2",
        "192.168.1.5",
        "169.254.169.254",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "0.0.0.0",
        "224.0.0.1",
    ],
)
def test_nonpublic_addresses_require_explicit_allowlisting(address):
    from app.services.data_source_security import allowed_address

    assert not allowed_address(ipaddress.ip_address(address), explicitly_allowed=False)


def test_allowlist_does_not_allow_metadata_or_multicast():
    from app.services.data_source_security import allowed_address

    assert allowed_address(ipaddress.ip_address("10.0.0.8"), explicitly_allowed=True)
    assert not allowed_address(ipaddress.ip_address("169.254.169.254"), explicitly_allowed=True)
    assert not allowed_address(ipaddress.ip_address("224.0.0.1"), explicitly_allowed=True)
    assert allowed_address(ipaddress.ip_address("8.8.8.8"), explicitly_allowed=False)


def test_password_cipher_is_bound_to_source_and_tenant(settings):
    from app.services.data_source_security import decrypt_password, encrypt_password

    settings = settings.model_copy(update={"data_source_key": SecretStr("a" * 64)})
    first = encrypt_password(settings, "source-password", tenant_id=11, source_id=8)
    second = encrypt_password(settings, "source-password", tenant_id=11, source_id=8)
    assert first != second
    assert "source-password" not in first
    assert decrypt_password(settings, first, tenant_id=11, source_id=8) == "source-password"
    with pytest.raises(AppError):
        decrypt_password(settings, first, tenant_id=12, source_id=8)
    with pytest.raises(AppError):
        decrypt_password(settings, first, tenant_id=11, source_id=9)


def test_missing_master_key_fails_closed(settings):
    from app.services.data_source_security import encrypt_password

    with pytest.raises(AppError) as exc:
        encrypt_password(settings, "secret", tenant_id=1, source_id=1)
    assert exc.value.status == 503
