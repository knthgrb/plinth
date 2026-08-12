import { redirect } from "next/navigation";
import { resetPayslipPinFromToken } from "@/actions/payslip-pin-reset";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default async function ResetPayslipPinPage(props: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const token = String(searchParams.token ?? "").trim();

  async function onSubmit(formData: FormData) {
    "use server";
    const newPin = String(formData.get("pin") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!token) throw new Error("Missing token");
    if (!/^\d{6,12}$/.test(newPin.trim())) {
      throw new Error("PIN must contain 6 to 12 digits");
    }
    if (newPin !== confirm) throw new Error("PINs do not match");

    await resetPayslipPinFromToken({ token, newPin });
    redirect(`/${params.organizationId}/payslips`);
  }

  return (
    <MainLayout>
      <div className="p-8 flex justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Reset payslip PIN</CardTitle>
          </CardHeader>
          <CardContent>
            {!token ? (
              <p className="text-sm text-red-600">
                This reset link is missing a token. Please request a new reset email.
              </p>
            ) : (
              <form action={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pin">New PIN</Label>
                  <Input
                    id="pin"
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="6 to 12 digits"
                    minLength={6}
                    maxLength={12}
                    pattern="[0-9]{6,12}"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm PIN</Label>
                  <Input
                    id="confirm"
                    name="confirm"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Confirm PIN"
                  />
                </div>
                <Button className="w-full" type="submit">
                  Save new PIN
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
