import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const items = await prisma.foodItem.findMany({
      orderBy: { expiry_date: 'asc' }
    });
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const newItem = await prisma.foodItem.create({
      data: {
        name: data.name,
        category: data.category || 'General',
        purchase_date: data.purchase_date,
        expiry_date: data.expiry_date,
        is_consumed: false,
      }
    });
    return NextResponse.json(newItem, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}

// DELETE all items — reset inventory
export async function DELETE() {
  try {
    await prisma.foodItem.deleteMany({});
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to reset inventory' }, { status: 500 });
  }
}
