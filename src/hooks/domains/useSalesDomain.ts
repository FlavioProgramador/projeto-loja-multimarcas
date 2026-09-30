import React, { useCallback } from 'react';
import { SalesService } from '../../services';
import { CartItem } from '../../types';
export function useSalesDomain(activeStoreId:string|null, refreshData:()=>Promise<void>, setCustomers:React.Dispatch<React.SetStateAction<any[]>>) {
 const processSale=useCallback(async(params:{cartItems:CartItem[];buyerName:string;cpf:string;paymentMethod:string;installments:number;discountValue:number;discountPercent:number;creditUsed?:number;}):Promise<{success:boolean;message:string;totalFinal:number}>=>{
   if(!activeStoreId) return {success:false,message:'Nenhuma loja ativa selecionada.',totalFinal:0};
   if(params.cartItems.length===0) return {success:false,message:'Carrinho vazio',totalFinal:0};
   if(!params.cartItems.every(item=>item.variantId)) return {success:false,message:'Há item sem identificador de variação válido.',totalFinal:0};
   const result=await SalesService.completeSale({...params,storeId:activeStoreId,discountValue:params.discountValue+(params.creditUsed||0),idempotencyKey:crypto.randomUUID()});
   if(result.success){ if((params.creditUsed||0)>0 && params.cpf){ setCustomers(prev=>prev.map(c=>c.cpf===params.cpf?{...c,saldoCredito:Math.max(0,(c.saldoCredito||0)-(params.creditUsed||0))}:c)); } await refreshData(); }
   return {success:result.success,message:result.message,totalFinal:result.totalFinal};
 },[activeStoreId,refreshData,setCustomers]);
 return {processSale};
}

