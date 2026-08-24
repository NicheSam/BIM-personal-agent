using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace RevitMCP.Core
{
    internal sealed class DynamicSourceAnalysis
    {
        public string SourceHash { get; set; }

        public bool UsesDestructiveApi { get; set; }

        public CSharpCompilation Compilation { get; set; }
    }

    internal static class DynamicCSharpPolicy
    {
        private const int MaximumSourceLength = 60000;

        private static readonly string[] BlockedNamespacePrefixes =
        {
            "Microsoft.Win32",
            "System.CodeDom",
            "System.Diagnostics",
            "System.IO",
            "System.Net",
            "System.Reflection",
            "System.Runtime.InteropServices",
            "System.Runtime.Loader",
            "System.Runtime.Remoting",
            "System.Security",
            "System.Threading"
        };

        private static readonly HashSet<string> BlockedTypeNames = new HashSet<string>(StringComparer.Ordinal)
        {
            "Autodesk.Revit.ApplicationServices.Application",
            "Autodesk.Revit.DB.BasicFileInfo",
            "Autodesk.Revit.DB.ExternalFileReference",
            "Autodesk.Revit.DB.FilePath",
            "Autodesk.Revit.DB.ModelPathUtils",
            "Autodesk.Revit.DB.SubTransaction",
            "Autodesk.Revit.DB.Transaction",
            "Autodesk.Revit.DB.TransactionGroup",
            "Autodesk.Revit.DB.TransmissionData",
            "System.Activator",
            "System.AppDomain",
            "System.Environment",
            "System.GC",
            "System.Type"
        };

        private static readonly HashSet<string> AllowedHostTypeNames = new HashSet<string>(StringComparer.Ordinal)
        {
            "RevitMCP.Core.IDynamicRevitCommand",
            "RevitMCP.Core.DynamicCommandMetadata",
            "RevitMCP.Core.DynamicRevitContext"
        };

        public static DynamicSourceAnalysis Analyze(
            string source,
            IEnumerable<MetadataReference> references)
        {
            if (string.IsNullOrWhiteSpace(source))
            {
                throw new InvalidOperationException("Dynamic C# source is required.");
            }

            if (source.Length > MaximumSourceLength)
            {
                throw new InvalidOperationException("Dynamic C# source exceeds the 60,000-character limit.");
            }

            string sourceHash = ComputeSourceHash(source);
            SyntaxTree syntaxTree = CSharpSyntaxTree.ParseText(
                source,
                new CSharpParseOptions(LanguageVersion.CSharp10));
            CompilationUnitSyntax root = syntaxTree.GetCompilationUnitRoot();
            ValidateSyntax(root);

            CSharpCompilation compilation = CSharpCompilation.Create(
                "RevitMCP.Dynamic." + sourceHash,
                new[] { syntaxTree },
                references,
                new CSharpCompilationOptions(
                    OutputKind.DynamicallyLinkedLibrary,
                    optimizationLevel: OptimizationLevel.Release,
                    allowUnsafe: false));

            List<Diagnostic> errors = compilation.GetDiagnostics()
                .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)
                .Take(20)
                .ToList();
            if (errors.Count > 0)
            {
                throw new InvalidOperationException("Dynamic C# compilation failed:\n" + FormatDiagnostics(errors));
            }

            SemanticModel semanticModel = compilation.GetSemanticModel(syntaxTree, true);
            bool usesDestructiveApi = ValidateSymbols(root, semanticModel, compilation.Assembly);
            return new DynamicSourceAnalysis
            {
                SourceHash = sourceHash,
                UsesDestructiveApi = usesDestructiveApi,
                Compilation = compilation
            };
        }

        private static void ValidateSyntax(CompilationUnitSyntax root)
        {
            if (root.ContainsDirectives)
            {
                throw new InvalidOperationException("Preprocessor directives are not allowed in dynamic C#.");
            }

            if (root.DescendantNodes().OfType<FieldDeclarationSyntax>().Any() ||
                root.DescendantNodes().OfType<EventDeclarationSyntax>().Any() ||
                root.DescendantNodes().OfType<EventFieldDeclarationSyntax>().Any() ||
                root.DescendantNodes().OfType<ConstructorDeclarationSyntax>().Any())
            {
                throw new InvalidOperationException("Dynamic command classes cannot declare fields, events, or constructors.");
            }

            if (root.DescendantNodes().Any(node =>
                    node is UnsafeStatementSyntax ||
                    node is PointerTypeSyntax ||
                    node is FunctionPointerTypeSyntax ||
                    node is StackAllocArrayCreationExpressionSyntax ||
                    node is AwaitExpressionSyntax ||
                    node is LockStatementSyntax ||
                    node is TypeOfExpressionSyntax))
            {
                throw new InvalidOperationException("Unsafe, pointer, stackalloc, await, lock, and typeof syntax is not allowed in dynamic C#.");
            }

            if (root.DescendantNodes().Any(IsExplicitlyUnboundedLoop))
            {
                throw new InvalidOperationException("Explicitly unbounded loops are not allowed in dynamic C#.");
            }

            if (root.DescendantTokens().Any(token =>
                    token.IsKind(SyntaxKind.UnsafeKeyword) ||
                    token.IsKind(SyntaxKind.ExternKeyword) ||
                    token.IsKind(SyntaxKind.AsyncKeyword)) ||
                root.DescendantNodes().OfType<IdentifierNameSyntax>()
                    .Any(identifier => identifier.Identifier.ValueText == "dynamic"))
            {
                throw new InvalidOperationException("unsafe, extern, async, and dynamic are not allowed in dynamic C#.");
            }

            foreach (UsingDirectiveSyntax usingDirective in root.Usings)
            {
                string namespaceName = usingDirective.Name?.ToString() ?? string.Empty;
                if (IsBlockedNamespace(namespaceName))
                {
                    throw new InvalidOperationException("Blocked namespace in dynamic C#: " + namespaceName);
                }
            }
        }

        private static bool ValidateSymbols(
            CompilationUnitSyntax root,
            SemanticModel semanticModel,
            IAssemblySymbol generatedAssembly)
        {
            bool usesDestructiveApi = false;
            IEnumerable<SyntaxNode> symbolNodes = root.DescendantNodes().Where(node =>
                node is InvocationExpressionSyntax ||
                node is ObjectCreationExpressionSyntax ||
                node is MemberAccessExpressionSyntax ||
                node is IdentifierNameSyntax);

            foreach (SyntaxNode node in symbolNodes)
            {
                if (node is ObjectCreationExpressionSyntax objectCreation)
                {
                    SymbolInfo typeSymbolInfo = semanticModel.GetSymbolInfo(objectCreation.Type);
                    ITypeSymbol declaredType = typeSymbolInfo.Symbol as ITypeSymbol ??
                        typeSymbolInfo.CandidateSymbols.OfType<ITypeSymbol>().FirstOrDefault();
                    ITypeSymbol createdType = semanticModel.GetTypeInfo(objectCreation).Type;
                    ITypeSymbol resolvedType = IsReliableType(declaredType)
                        ? declaredType
                        : IsReliableType(createdType)
                            ? createdType
                            : ResolveMetadataType(objectCreation.Type.ToString(), root, semanticModel.Compilation);
                    string createdTypeName = GetFullTypeName(resolvedType);
                    if (BlockedTypeNames.Contains(createdTypeName))
                    {
                        throw new InvalidOperationException("Blocked API in dynamic C#: " + createdTypeName);
                    }

                    if (resolvedType == null || resolvedType.TypeKind == TypeKind.Error)
                    {
                        string syntaxTypeName = objectCreation.Type.ToString();
                        string blockedTypeName = BlockedTypeNames.FirstOrDefault(name =>
                            name.Equals(syntaxTypeName, StringComparison.Ordinal) ||
                            name.EndsWith("." + syntaxTypeName, StringComparison.Ordinal));
                        if (blockedTypeName != null)
                        {
                            throw new InvalidOperationException("Blocked API in dynamic C#: " + blockedTypeName);
                        }

                        throw new InvalidOperationException(
                            "Dynamic C# could not resolve object creation type: " + syntaxTypeName);
                    }
                }

                SymbolInfo symbolInfo = semanticModel.GetSymbolInfo(node);
                ISymbol symbol = symbolInfo.Symbol ?? symbolInfo.CandidateSymbols.FirstOrDefault();
                if (symbol == null)
                {
                    continue;
                }

                IAssemblySymbol containingAssembly = symbol.ContainingAssembly;
                if (containingAssembly != null && SymbolEqualityComparer.Default.Equals(containingAssembly, generatedAssembly))
                {
                    continue;
                }

                string namespaceName = symbol.ContainingNamespace?.ToDisplayString() ?? string.Empty;
                string containingTypeName = GetFullTypeName(symbol.ContainingType);
                string hostTypeName = symbol is INamedTypeSymbol namedType
                    ? GetFullTypeName(namedType)
                    : containingTypeName;
                if (IsBlockedNamespace(namespaceName) ||
                    BlockedTypeNames.Contains(containingTypeName) ||
                    BlockedTypeNames.Contains(hostTypeName))
                {
                    throw new InvalidOperationException("Blocked API in dynamic C#: " + symbol.ToDisplayString());
                }

                if (symbol is INamespaceSymbol)
                {
                    continue;
                }

                if (namespaceName.StartsWith("RevitMCP", StringComparison.Ordinal) &&
                    !AllowedHostTypeNames.Contains(hostTypeName))
                {
                    throw new InvalidOperationException("Dynamic C# cannot call RevitMCP host internals: " + symbol.ToDisplayString());
                }

                if (containingTypeName == "Autodesk.Revit.DB.Document")
                {
                    if (symbol.Name == "Delete")
                    {
                        usesDestructiveApi = true;
                    }

                    if (symbol.Name == "Application" ||
                        symbol.Name == "Close" ||
                        symbol.Name == "Export" ||
                        symbol.Name == "Import" ||
                        symbol.Name == "LoadFamily" ||
                        symbol.Name == "PrintManager" ||
                        symbol.Name == "Save" ||
                        symbol.Name == "SaveAs" ||
                        symbol.Name == "SynchronizeWithCentral")
                    {
                        throw new InvalidOperationException("Blocked document-management API in dynamic C#: " + symbol.Name);
                    }
                }
            }

            return usesDestructiveApi;
        }

        private static bool IsBlockedNamespace(string namespaceName)
        {
            return BlockedNamespacePrefixes.Any(prefix =>
                namespaceName.Equals(prefix, StringComparison.Ordinal) ||
                namespaceName.StartsWith(prefix + ".", StringComparison.Ordinal));
        }

        private static bool IsExplicitlyUnboundedLoop(SyntaxNode node)
        {
            if (node is ForStatementSyntax forStatement && forStatement.Condition == null)
            {
                return true;
            }

            if (node is WhileStatementSyntax whileStatement)
            {
                return whileStatement.Condition.IsKind(SyntaxKind.TrueLiteralExpression);
            }

            if (node is DoStatementSyntax doStatement)
            {
                return doStatement.Condition.IsKind(SyntaxKind.TrueLiteralExpression);
            }

            return false;
        }

        private static string GetFullTypeName(ITypeSymbol type)
        {
            if (type == null)
            {
                return string.Empty;
            }

            const string globalPrefix = "global::";
            string name = type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
            return name.StartsWith(globalPrefix, StringComparison.Ordinal)
                ? name.Substring(globalPrefix.Length)
                : name;
        }

        private static bool IsReliableType(ITypeSymbol type)
        {
            return type != null &&
                   type.TypeKind != TypeKind.Error &&
                   type.ContainingNamespace != null &&
                   !type.ContainingNamespace.IsGlobalNamespace;
        }

        private static ITypeSymbol ResolveMetadataType(
            string syntaxTypeName,
            CompilationUnitSyntax root,
            Compilation compilation)
        {
            if (string.IsNullOrWhiteSpace(syntaxTypeName) || syntaxTypeName.Contains("<"))
            {
                return null;
            }

            var metadataNames = new List<string>();
            if (syntaxTypeName.Contains("."))
            {
                metadataNames.Add(syntaxTypeName.Replace("global::", string.Empty));
            }
            else
            {
                metadataNames.AddRange(root.Usings
                    .Where(usingDirective => usingDirective.Alias == null &&
                                             !usingDirective.StaticKeyword.IsKind(SyntaxKind.StaticKeyword))
                    .Select(usingDirective => usingDirective.Name?.ToString())
                    .Where(namespaceName => !string.IsNullOrWhiteSpace(namespaceName))
                    .Select(namespaceName => namespaceName + "." + syntaxTypeName));
            }

            INamedTypeSymbol[] matches = metadataNames
                .Distinct(StringComparer.Ordinal)
                .Select(compilation.GetTypeByMetadataName)
                .Where(type => type != null)
                .ToArray();
            return matches.Length == 1 ? matches[0] : null;
        }

        private static string FormatDiagnostics(IEnumerable<Diagnostic> diagnostics)
        {
            return string.Join("\n", diagnostics.Select(diagnostic =>
            {
                FileLinePositionSpan span = diagnostic.Location.GetLineSpan();
                int line = span.StartLinePosition.Line + 1;
                int column = span.StartLinePosition.Character + 1;
                return $"{diagnostic.Id} ({line},{column}): {diagnostic.GetMessage()}";
            }));
        }

        public static string ComputeSourceHash(string source)
        {
            if (string.IsNullOrWhiteSpace(source))
            {
                throw new InvalidOperationException("Dynamic C# source is required.");
            }

            if (source.Length > MaximumSourceLength)
            {
                throw new InvalidOperationException("Dynamic C# source exceeds the 60,000-character limit.");
            }

            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(source));
                return string.Concat(hash.Select(value => value.ToString("x2")));
            }
        }
    }
}
