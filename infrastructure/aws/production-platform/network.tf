resource "aws_vpc" "production" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "production" {
  vpc_id = aws_vpc.production.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.production.id
  availability_zone       = each.value.az
  cidr_block              = each.value.cidr
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-public-${each.key}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id                  = aws_vpc.production.id
  availability_zone       = each.value.az
  cidr_block              = each.value.cidr
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-private-${each.key}"
    Tier = "private"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.production.id

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.production.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  for_each = aws_subnet.public

  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-${each.key}"
  }

  depends_on = [aws_internet_gateway.production]
}

resource "aws_nat_gateway" "production" {
  for_each = aws_subnet.public

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id

  tags = {
    Name = "${local.name_prefix}-nat-${each.key}"
  }

  depends_on = [aws_internet_gateway.production]
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private

  vpc_id = aws_vpc.production.id

  tags = {
    Name = "${local.name_prefix}-private-${each.key}"
  }
}

resource "aws_route" "private_internet" {
  for_each = aws_route_table.private

  route_table_id         = each.value.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.production[each.key].id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.production.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id], values(aws_route_table.private)[*].id)

  tags = {
    Name = "${local.name_prefix}-s3"
  }
}

# The sandbox fleet remains in the existing default VPC. Peering keeps sandbox
# traffic to AI Dream on private AWS addresses once the internal listener exists.
resource "aws_vpc_peering_connection" "legacy" {
  vpc_id      = aws_vpc.production.id
  peer_vpc_id = data.aws_vpc.legacy.id
  auto_accept = true

  tags = {
    Name = "${local.name_prefix}-to-sandbox-fleet"
  }
}

data "aws_route_tables" "legacy" {
  vpc_id = data.aws_vpc.legacy.id
}

resource "aws_route" "production_to_legacy_public" {
  route_table_id            = aws_route_table.public.id
  destination_cidr_block    = data.aws_vpc.legacy.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.legacy.id
}

resource "aws_route" "production_to_legacy_private" {
  for_each = aws_route_table.private

  route_table_id            = each.value.id
  destination_cidr_block    = data.aws_vpc.legacy.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.legacy.id
}

resource "aws_route" "legacy_to_production" {
  for_each = toset(data.aws_route_tables.legacy.ids)

  route_table_id            = each.value
  destination_cidr_block    = aws_vpc.production.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.legacy.id
}
